"""
StyleJSON 清洗脚本
清洗已有数据集中 Card 和 Label 的 template HTML 中的 transform 样式
保留 Global 元素中的 transform（因为 Global 需要绝对定位）
"""
import os
import re
import json
from pathlib import Path


def clean_transform_from_html(style_code: dict) -> dict:
    """
    清洗 stylejson 中 Card 和 Label 的 template HTML 中的 transform 样式
    保留 Global 元素中的 transform（因为 Global 需要绝对定位）
    """
    if not isinstance(style_code, dict):
        return style_code
    
    # 需要清洗的元素类型（Card 和 Label）
    elements_to_clean = ['Card', 'Label']
    
    for element_type in elements_to_clean:
        if element_type not in style_code:
            continue
        
        for item in style_code[element_type]:
            if 'template' not in item:
                continue
            
            # 移除 transform 样式（包括 transform 和 -webkit-transform 等前缀）
            # 匹配 transform: xxx; 或 transform: xxx (最后一项无分号)
            cleaned_template = re.sub(
                r'\s*(?:-webkit-|-moz-|-ms-|-o-)?transform\s*:\s*[^;]+;?',
                '',
                item['template']
            )
            item['template'] = cleaned_template
    
    return style_code


def clean_stylejson_file(file_path: Path) -> bool:
    """清洗单个 stylejson 文件"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            style_code = json.load(f)
        
        # 清洗 transform
        cleaned_style_code = clean_transform_from_html(style_code)
        
        # 写回文件
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(cleaned_style_code, f, ensure_ascii=False, indent=2)
        
        return True
    except Exception as e:
        print(f"  ❌ 清洗失败 {file_path.name}: {e}")
        return False


def clean_all_sessions(output_dir: str):
    """清洗所有 session 的 stylejson 文件"""
    output_path = Path(output_dir)
    if not output_path.exists():
        print(f"❌ Output directory not found: {output_dir}")
        return

    # 查找所有 session 目录
    sessions = [d for d in output_path.iterdir() if d.is_dir() and 'session' in d.name.lower()]
    print(f"📂 Found {len(sessions)} sessions")

    total_files = 0
    success_files = 0
    failed_files = 0

    for session_dir in sorted(sessions):
        node4_dir = session_dir / 'node4'
        if not node4_dir.exists():
            continue

        # 查找所有 stylejson 文件
        style_files = sorted([f for f in node4_dir.glob('style_*.json')])
        if not style_files:
            continue

        print(f"\n🔄 Processing session: {session_dir.name}")

        for style_file in style_files:
            total_files += 1
            print(f"  📄 {style_file.name}...", end=' ')
            
            # 读取并检查是否有 Card 或 Label
            try:
                with open(style_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                has_card = 'Card' in data and any('template' in item for item in data['Card'])
                has_label = 'Label' in data and any('template' in item for item in data['Label'])
                
                if not has_card and not has_label:
                    print("⏭️ 跳过 (无 Card/Label)")
                    continue
                
                # 清洗文件
                if clean_stylejson_file(style_file):
                    success_files += 1
                    print("✅ 已清洗")
                else:
                    failed_files += 1
            except Exception as e:
                failed_files += 1
                print(f"❌ 错误: {e}")

    print(f"\n{'='*60}")
    print(f"✅ 清洗完成!")
    print(f"   总文件数: {total_files}")
    print(f"   成功: {success_files}")
    print(f"   失败: {failed_files}")
    print(f"{'='*60}")


def main():
    # 配置 output 目录
    output_dir = os.path.join(os.path.dirname(__file__), 'output')
    
    print("=" * 60)
    print("🔄 StyleJSON 清洗工具")
    print("   移除 Card 和 Label 中的 transform 样式")
    print("   保留 Global 中的 transform 样式")
    print("=" * 60)
    print(f"   Output dir: {output_dir}")
    print()

    # 确认执行
    response = input("Continue? (y/N): ")
    if response.lower() != 'y':
        print("Cancelled.")
        return

    clean_all_sessions(output_dir)


if __name__ == '__main__':
    main()
