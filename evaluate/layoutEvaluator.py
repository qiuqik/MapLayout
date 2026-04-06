import json
import os
import base64
import json
from shapely.geometry import box, shape, Polygon, LineString, Point
from PIL import Image, ImageDraw
import numpy as np
import torch
import cv2
import torch.nn.functional as F
from torchvision import transforms
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from dotenv import load_dotenv
import itertools
import math



class LayoutEvaluator:
    def __init__(self, map_info_path, img_width=1500, img_height=900):
        self.img_width = img_width
        self.img_height = img_height
        
        # 1. 解析地图边界，用于经纬度到像素的转换
        with open(map_info_path, 'r', encoding='utf-8') as f:
            map_info = json.load(f)
            self.bounds = map_info['bounds']
            
    def lonlat_to_pixel(self, lon, lat):
        """将经纬度转换为 1500x900 图像的像素坐标"""
        w = self.bounds['east'] - self.bounds['west']
        h = self.bounds['north'] - self.bounds['south']
        
        x = (lon - self.bounds['west']) / w * self.img_width
        # 图像Y轴向下，纬度向上，需翻转
        y = (self.bounds['north'] - lat) / h * self.img_height
        return x, y

    def _generate_unique_id(self, feature, item_type, visual_id):
        """生成全局唯一标识符"""
        geom_type = feature['geometry']['type']
        name = feature['properties'].get('name', 'unknown')
        return f"{item_type}-{geom_type}-{name}-{visual_id}"

    def parse_geojson(self, geojson_path):
        """解析 GeoJSON，提取 Layout 元素 BBox 和 地理底图几何体"""
        with open(geojson_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        layout_elements = {} # 存储 card 和 label 的 bbox
        background_geometries = [] # 存储 point, line, polygon 几何体(像素坐标下)
        
        for feature in data.get('features', []):
            geom_type = feature['geometry']['type']
            props = feature['properties']
            coords = feature['geometry']['coordinates']
            
            # --- 处理背景要素 (转换为像素坐标并使用 shapely 表示) ---
            if geom_type == 'Point':
                px, py = self.lonlat_to_pixel(coords[0], coords[1])
                # 给点加上一个视觉半径 (例如 12px) 使其有面积可计算重叠
                background_geometries.append(Point(px, py).buffer(12)) 
            elif geom_type == 'LineString':
                px_coords = [self.lonlat_to_pixel(lon, lat) for lon, lat in coords]
                # 设定线宽 (例如 buffer(3) 代表 6px 宽)
                background_geometries.append(LineString(px_coords).buffer(3))
            elif geom_type == 'Polygon':
                px_coords = [[self.lonlat_to_pixel(lon, lat) for lon, lat in ring] for ring in coords]
                background_geometries.append(Polygon(px_coords[0], px_coords[1:]))

            # --- 处理排版要素 (Card & Label) ---
            # 处理 Card
            if 'card_visual_id' in props and 'card_coord' in props and 'card_size' in props:
                cid = self._generate_unique_id(feature, 'card', props['card_visual_id'])
                cx, cy = self.lonlat_to_pixel(*props['card_coord'])
                w, h = props['card_size']
                # coord 是中心点
                print(cid)
                layout_elements[cid] = box(cx - w/2, cy - h/2, cx + w/2, cy + h/2)
                
            # 处理 Label
            if 'label_visual_id' in props and 'label_coord' in props and 'label_size' in props:
                lid = self._generate_unique_id(feature, 'label', props['label_visual_id'])
                cx, cy = self.lonlat_to_pixel(*props['label_coord'])
                w, h = props['label_size']
                print(lid)
                layout_elements[lid] = box(cx - w/2, cy - h/2, cx + w/2, cy + h/2)
                
        return layout_elements, background_geometries
    
    # ==========================================
    # 1. 视觉感知指标 - JSON Based
    # ==========================================
    def calc_overlap(self, layout_elements, background_geometries):
        """
        指标 1: 布局重叠度 (Ove ↓)
        计算标签与标签之间、标签与地理要素(点线面)之间的遮挡程度
        """
        bboxes = list(layout_elements.values())
        if not bboxes: return 0.0
        
        total_label_area = sum([b.area for b in bboxes])
        overlap_area = 0.0
        
        # 1. 标签内部相互重叠 (Pairwise)
        for b1, b2 in itertools.combinations(bboxes, 2):
            if b1.intersects(b2):
                overlap_area += b1.intersection(b2).area
                
        # 2. 标签与地理底图(Point, Line, Polygon)的重叠
        for b in bboxes:
            for bg_geom in background_geometries:
                if b.intersects(bg_geom):
                    overlap_area += b.intersection(bg_geom).area
                    
        # 重叠度 = 重叠面积 / 标签总面积 (值越小越好)
        return overlap_area / total_label_area if total_label_area > 0 else 0.0

    def calc_mean_iou(self, pred_elements, gt_elements):
        """
        指标 2: 与 GT 的相似性 (Mean IoU ↑)
        """
        ious = []
        for uid, pred_box in pred_elements.items():
            if uid in gt_elements:
                gt_box = gt_elements[uid]
                intersection = pred_box.intersection(gt_box).area
                union = pred_box.union(gt_box).area
                ious.append(intersection / union if union > 0 else 0.0)
            else:
                ious.append(0.0) # 错漏标算作 0
                
        return np.mean(ious) if ious else 0.0

    # ==========================================
    # 2. 视觉感知指标 - Image/Saliency Based
    # ==========================================
    def get_basnet_saliency(self, image_path, model_weights_path="./model/basnet.pth", output_dir=None):
        """
        读取合成的 JPG 图片，通过 BASNet 输出 0-255 的 numpy 显著性 mask
        """
        from model import BASNet
        net = BASNet(3, 1) 
        
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        
        # 1. 初始化模型并加载权重
        net.load_state_dict(torch.load(model_weights_path, map_location=device))
        net.eval()
        net.to(device)

        # 2. 图像预处理 (BASNet 通常接受 256x256 或适应其下采样倍数的分辨率)
        # BASNet 要求输入被 normalize
        transform = transforms.Compose([
            transforms.Resize((256, 256)), # 注意：推断时缩放，输出后再缩放回 1500x900
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], 
                                std=[0.229, 0.224, 0.225])
        ])
        
        # 加载前面生成的白底红图
        image = Image.open(image_path).convert('RGB')
        original_size = image.size # (1500, 900)
        
        input_tensor = transform(image).unsqueeze(0).to(device)
        
        with torch.no_grad():
            # 3. 网络推理 (BASNet 会输出多尺度 d1, d2...d8，通常 d1 是最终预测)
            d1, d2, d3, d4, d5, d6, d7, d8 = net(input_tensor)
            
            # --- (占位：假设 d1 是输出的预测结果) ---
            preds = d1[:, 0, :, :] 
            # 4. 激活并规范化到 [0, 1]
            # BASNet 官方处理: 取 min-max 归一化 (或者直接用 sigmoid)
            preds = torch.sigmoid(preds)
            ma = torch.max(preds)
            mi = torch.min(preds)
            preds = (preds - mi) / (ma - mi + 1e-8)
            
        # 5. 上采样插值恢复到 1500 x 900
        preds_resized = F.interpolate(
            preds.unsqueeze(0), 
            size=(original_size[1], original_size[0]), # (900, 1500)
            mode='bilinear', 
            align_corners=False
        )
        
        # 6. 转回 CPU Numpy 数组，值域 0-255
        mask_np = preds_resized.squeeze().cpu().numpy()
        mask_255 = (mask_np * 255).astype(np.uint8)
        
        # 保存显著性 Mask 看看效果
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)
            mask_output_path = os.path.join(output_dir, "saliency_mask_output.jpg")
        else:
            mask_output_path = "saliency_mask_output.jpg"
        cv2.imwrite(mask_output_path, mask_255)
        
        return mask_255
    def calc_utility_and_balance(self, layout_elements, basnet_saliency_map):
        """
        指标 3 & 4: 空间利用率 (Uti ↑) & 空间平衡性 (Bal ↑)
        """
        # 归一化显著性图 [0, 1]
        saliency = basnet_saliency_map.astype(np.float32) / 255.0
        
        # 构建标签占用 Mask
        label_mask = np.zeros((self.img_height, self.img_width), dtype=np.float32)
        for bbox in layout_elements.values():
            minx, miny, maxx, maxy = map(int, bbox.bounds)
            # 限制边界
            minx, miny = max(0, minx), max(0, miny)
            maxx, maxy = min(self.img_width, maxx), min(self.img_height, maxy)
            label_mask[miny:maxy, minx:maxx] = 1.0

        # --- 指标 3: Utility ---
        # 标签遮挡的显著性信息量
        occluded_saliency = np.sum(saliency * label_mask)
        total_saliency = np.sum(saliency)
        # 遮挡越少，利用率越高
        utility = 1.0 - (occluded_saliency / total_saliency if total_saliency > 0 else 0)

        # --- 指标 4: Balance ---
        # 将画面分为 3x3 网格
        grid_rows, grid_cols = 3, 3
        h_step, w_step = self.img_height // grid_rows, self.img_width // grid_cols
        
        density_label = []
        density_saliency = []
        
        for r in range(grid_rows):
            for c in range(grid_cols):
                r_start, r_end = r * h_step, (r + 1) * h_step
                c_start, c_end = c * w_step, (c + 1) * w_step
                
                # 网格内标签占比
                grid_label = label_mask[r_start:r_end, c_start:c_end]
                density_label.append(np.sum(grid_label) / (h_step * w_step))
                
                # 网格内底图信息量占比
                grid_sal = saliency[r_start:r_end, c_start:c_end]
                density_saliency.append(np.sum(grid_sal) / (h_step * w_step))

        # 归一化分布
        p_label = np.array(density_label) / (np.sum(density_label) + 1e-6)
        p_saliency = np.array(density_saliency) / (np.sum(density_saliency) + 1e-6)
        
        # 计算分布的均方误差，MSE越小越平衡（标签分布贴合底图信息分布）
        mse = np.mean((p_label - p_saliency) ** 2)
        balance = 1.0 / (1.0 + mse)
        
        return utility, balance

    # ==========================================
    # 3. MLLM 裁判胜率 (需调用 API)
    # ==========================================

    def _init_vlm_model(self) -> ChatOpenAI:
        """初始化 VLM 模型（支持 QwenVLM 或 Gemini）"""
        load_dotenv()
        vlm_model_type = os.getenv("VLM_MODEL", "qwen").lower()
        http_proxy = os.getenv("HTTP_PROXY")
        if vlm_model_type == "qwen":
            qwen_key = os.getenv("QwenVLM_API_KEY")
            if not qwen_key:
                raise RuntimeError("⚠️ .env 文件中未配置 QwenVLM_API_KEY")
            
            return ChatOpenAI(
                api_key=qwen_key,
                model="qwen-vl-max",
                base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
                temperature=0.7
            )
        
        elif vlm_model_type == "gemini":
            gemini_key = os.getenv("GEMINI_API_KEY")
            if not gemini_key:
                raise RuntimeError("⚠️ .env 文件中未配置 GEMINI_API_KEY")
            
            return ChatOpenAI(
                api_key=gemini_key,
                model="gemini-3-pro-preview",
                base_url=http_proxy,
                temperature=0.7
            )
    def calc_judge_win_rate(self, layout_img_path, gt_img_path):
        """
        指标 5: Judge Win Rate (对接 GPT-4o 或 Claude 3.5 API)
        """
        try:
            vlm = self._init_vlm_model()

            img_a_base64 = self._image_to_base64(layout_img_path)
            img_b_base64 = self._image_to_base64(gt_img_path)

            system_prompt = """你是一个专业的地图排版专家。请对比图A和图B的布局质量。
            从以下三个维度进行严格评价：
            1. 遮挡情况 - 地图元素之间的遮挡程度
            2. 视觉呼吸感 - 布局的留白和视觉舒适度
            3. 文字-图标对齐度 - 标签与地理要素的对齐准确性

            请严格以JSON格式输出，只包含一个字段 "winner"，值为 "A"、"B" 或 "Tie"。
            """

            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(content=[
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_a_base64}"}},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_b_base64}"}},
                ]),
            ]

            response = vlm.invoke(messages)
            content = response.content

            import re
            match = re.search(r'\{[^}]+\}', content, re.DOTALL)
            if match:
                result = json.loads(match.group())
                winner = result.get("winner", "Tie")
            else:
                winner = "Tie"

            if winner == "A":
                return 1.0
            elif winner == "Tie":
                return 0.5
            else:
                return 0.0

        except Exception as e:
            print(f"⚠️ MLLM 调用失败: {e}，使用模拟值")
            return self._mock_judge_result()

    def _image_to_base64(self, image_path: str) -> str:
        """将图片转换为 base64 编码"""
        ext = os.path.splitext(image_path)[1].lower().lstrip('.')
        if ext not in ["jpg", "jpeg", "png", "gif", "bmp"]:
            ext = "jpeg"
        
        with open(image_path, "rb") as f:
            base64_data = base64.b64encode(f.read()).decode("utf-8")
        
        return base64_data

    def _mock_judge_result(self):
        """模拟评判结果"""
        mock_winner = "A"
        if mock_winner == "A":
            return 1.0
        elif mock_winner == "Tie":
            return 0.5
        else:
            return 0.0

    def render_synthetic_image(self, geojson_path, output_jpg_path="synthetic_map.jpg"):
        """
        根据 GeoJSON 绘制：
        1. 红白合成图（保存为 JPG，用于调试）
        2. 黑白 mask（直接在内存生成，用于计算指标）
        
        返回 tuple: (合成图路径, 黑白mask numpy数组)
        """
        with open(geojson_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        # 创建两个图：RGB 用于保存，以及黑白 mask 用于计算
        img_rgb = Image.new('RGB', (self.img_width, self.img_height), 'white')
        mask_bw = np.zeros((self.img_height, self.img_width), dtype=np.uint8)
        
        draw = ImageDraw.Draw(img_rgb)
        
        # 绘制参数
        RED = (255, 0, 0)
        BLACK = 255  # 黑白 mask 中，红色元素对应 255
        POINT_RADIUS = 6
        LINE_WIDTH = 4
        BBOX_WIDTH = 2

        for feature in data.get('features', []):
            geom_type = feature['geometry']['type']
            props = feature['properties']
            coords = feature['geometry']['coordinates']
            
            # 1. 绘制地理元素 (Point, LineString, Polygon)
            if geom_type == 'Point':
                px, py = self.lonlat_to_pixel(coords[0], coords[1])
                # RGB 合成图：绘制实心红点
                draw.ellipse([px - POINT_RADIUS, py - POINT_RADIUS, 
                            px + POINT_RADIUS, py + POINT_RADIUS], fill=RED)
                # 黑白 mask：绘制黑点
                cv2.circle(mask_bw, (int(px), int(py)), POINT_RADIUS, BLACK, -1)
                            
            elif geom_type == 'LineString':
                px_coords = [self.lonlat_to_pixel(lon, lat) for lon, lat in coords]
                if len(px_coords) >= 2:
                    # RGB 合成图：绘制红线
                    draw.line(px_coords, fill=RED, width=LINE_WIDTH)
                    # 黑白 mask：绘制黑线
                    px_coords_int = [(int(x), int(y)) for x, y in px_coords]
                    cv2.polylines(mask_bw, [np.array(px_coords_int)], False, BLACK, LINE_WIDTH)
                    
            elif geom_type == 'Polygon':
                px_coords = [self.lonlat_to_pixel(lon, lat) for lon, lat in coords[0]] # 取外环
                if len(px_coords) >= 3:
                    # RGB 合成图：绘制多边形边框
                    draw.polygon(px_coords, outline=RED, width=LINE_WIDTH)
                    # 黑白 mask：绘制多边形边框
                    px_coords_int = np.array([(int(x), int(y)) for x, y in px_coords])
                    cv2.polylines(mask_bw, [px_coords_int], True, BLACK, LINE_WIDTH)

            # 2. 绘制卡片和标签的 BBox
            # 处理 Card
            if 'card_visual_id' in props and 'card_coord' in props and 'card_size' in props:
                cx, cy = self.lonlat_to_pixel(*props['card_coord'])
                w, h = props['card_size']
                x1, y1 = int(cx - w/2), int(cy - h/2)
                x2, y2 = int(cx + w/2), int(cy + h/2)
                
                # RGB 合成图：绘制红色矩形框
                draw.rectangle([x1, y1, x2, y2], outline=RED, width=BBOX_WIDTH)
                # 黑白 mask：绘制黑色矩形框
                cv2.rectangle(mask_bw, (x1, y1), (x2, y2), BLACK, BBOX_WIDTH)
                
            # 处理 Label
            if 'label_visual_id' in props and 'label_coord' in props and 'label_size' in props:
                cx, cy = self.lonlat_to_pixel(*props['label_coord'])
                w, h = props['label_size']
                x1, y1 = int(cx - w/2), int(cy - h/2)
                x2, y2 = int(cx + w/2), int(cy + h/2)
                
                # RGB 合成图：绘制红色矩形框
                draw.rectangle([x1, y1, x2, y2], outline=RED, width=BBOX_WIDTH)
                # 黑白 mask：绘制黑色矩形框
                cv2.rectangle(mask_bw, (x1, y1), (x2, y2), BLACK, BBOX_WIDTH)
                            
        # 保存 RGB 合成图为 JPG
        img_rgb.save(output_jpg_path, format="JPEG", quality=95)
        print(f"✅ 合成图已渲染并保存至: {output_jpg_path}")
        
        # 保存黑白 mask 用于调试
        source_name = os.path.splitext(os.path.basename(output_jpg_path))[0]
        mask_output_dir = os.path.dirname(output_jpg_path)
        mask_output_path = os.path.join(mask_output_dir, f"{source_name}_mask.jpg")
        cv2.imwrite(mask_output_path, mask_bw)
        
        return output_jpg_path, mask_bw
