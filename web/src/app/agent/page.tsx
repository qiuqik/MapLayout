'use client';

import React, { useEffect, useState } from 'react';
import AgentDialog from '@/components/mapagent/AgentDialog';
import { AgentMapProvider, useAgentMap } from '@/lib/agentMapContext';
import { Separator } from '@/components/ui/separator';
import dynamic from 'next/dynamic';
import ForceParamsPanel, { type ForceParamsOverride, type FieldParamsOverride } from '@/components/mapagent/ForceParamsPanel';

import { API_BASE_URL } from '@/lib/api';

// --- 配置常量 ---

const TravelMapWithNoSSR = dynamic(
  () => import('@/components/mapagent/TravelMap'),
  { ssr: false }
);

const DEFAULT_FORCE_OVERRIDE: ForceParamsOverride = {
  linkStrength: 0.4,
  lift: 2,
  collideStrength: 3.5,
  fieldStrength: 5.5,
  iterations: 360,
  leaderThreshold: 28,
};

const DEFAULT_FIELD_OVERRIDE: FieldParamsOverride = {
  sigma: 28,
  strength: 4500,
  obstaclePadding: 6,
  cellSize: 24,
};

// Node 面板的 Tab 配置
const NODE_TABS = [
  { id: 'node1', label: 'Intent Recognition' },
  { id: 'node2', label: 'Visual Structure' },
  { id: 'node3', label: 'Geo Data' },
  { id: 'node4', label: 'Style Code' },
] as const;

type TabId = typeof NODE_TABS[number]['id'];

function AgentPageContent() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [currentSession, setCurrentSession] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<TabId>('node1');
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [forceParams, setForceParams] = useState<ForceParamsOverride>({ ...DEFAULT_FORCE_OVERRIDE });
  const [fieldParams, setFieldParams] = useState<FieldParamsOverride>({ ...DEFAULT_FIELD_OVERRIDE });
  
  const { setSpecfilename, setManifest, setGeojson, manifest, geojson } = useAgentMap();

  // 加载特定会话数据
  const loadSession = async (sessionId: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/multimodal/session/${sessionId}`);
      const data = await res.json();
      
      setCurrentSession(data);
      
      if (data.geojson) setGeojson(data.geojson);
      if (data.style_code) setManifest(data.style_code);
      
    } catch (error) {
      console.error('加载会话失败:', error);
    }
  };

  // 初始化获取会话列表并排序
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/multimodal/sessions`)
      .then(res => res.json())
      .then(data => {
        let sessionList = data.sessions || [];
        
        // 按照 session_id 降序排列 (保证最新的排在最前)
        sessionList = sessionList.sort((a: any, b: any) => 
          b.session_id.localeCompare(a.session_id)
        );

        setSessions(sessionList);
        
        if (sessionList.length > 0) {
          loadSession(sessionList[0].session_id);
        }
      })
      .catch(err => console.error('获取历史会话失败:', err));
  }, []);

  return (
    <div className="flex flex-1 overflow-hidden bg-gray-50">
      {/* 左侧控制栏 */}
      <div className="flex flex-col flex-shrink-0 w-[21%] min-w-[300px] h-full bg-white shadow-lg p-4 z-10 border-r">
        <div className="sticky top-0 z-10 mb-4 bg-white pb-2">
          <h1 className="text-lg font-bold text-gray-800 tracking-tight">AgentMap Layout</h1>
        </div>
        
        <AgentDialog />
        
        <Separator className="my-5" />
        
        {/* 历史会话列表 */}
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Historical Sessions</h3>
        <div className="h-36 overflow-y-auto pr-1 space-y-1 custom-scrollbar">
          {sessions.length === 0 ? (
            <div className="text-xs text-gray-400 text-center mt-4">暂无历史会话</div>
          ) : (
            <ul className="space-y-1">
              {sessions.map(s => (
                <li key={s.session_id}>
                  <button
                    className={`w-full text-sm text-left px-3 py-1.5 rounded-md transition-colors truncate ${
                      currentSession?.session_id === s.session_id 
                        ? 'bg-blue-50 text-black font-medium' 
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                    onClick={() => loadSession(s.session_id)}
                  >
                    {s.session_id}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        
        <Separator className="my-5" />

        {/* 视图控制开关 (已将 Inline Style 转为 Tailwind) */}
        <div className="flex gap-2">
          <button
            onClick={() => setShowHeatmap(v => !v)}
            className={`flex-1 px-2 py-1.5 rounded-md border-[1.5px] text-[11px] font-semibold transition-all ${
              showHeatmap 
                ? 'border-amber-500 bg-amber-50 text-amber-700' 
                : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
            }`}
          >
            {showHeatmap ? '🟠 Heatmap ON' : '🌡 Heatmap'}
          </button>
          <button
            onClick={() => setShowDebugPanel(v => !v)}
            className={`flex-1 px-2 py-1.5 rounded-md border-[1.5px] text-[11px] font-semibold transition-all ${
              showDebugPanel 
                ? 'border-blue-500 bg-blue-50 text-blue-700' 
                : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
            }`}
          >
            {showDebugPanel ? '🔵 Debug ON' : '⚙ Debug'}
          </button>
        </div>

        <Separator className="my-5" />

        {/* 多节点输出展示区 (DRY 优化后) */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Node Outputs</h3>
          
          <div className="flex border-b border-gray-200">
            {NODE_TABS.map(tab => (
              <button 
                key={tab.id}
                className={`flex-1 text-[11px] py-1.5 px-1 transition-colors relative ${
                  activeTab === tab.id 
                    ? 'text-blue-600 font-medium' 
                    : 'text-gray-500 hover:text-gray-800'
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <span className="absolute bottom-[-1px] left-0 w-full h-[2px] bg-blue-500" />
                )}
              </button>
            ))}
          </div>
          
          <div className="flex-1 overflow-auto mt-3 text-xs custom-scrollbar">
            {currentSession && currentSession[activeTab] ? (
              <div className="p-3 bg-gray-50/80 rounded-md border border-gray-100 h-full">
                <pre className="whitespace-pre-wrap font-mono text-gray-700">
                  {JSON.stringify(currentSession[activeTab], null, 2)}
                </pre>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400 p-4 text-center border border-dashed rounded-md">
                {currentSession ? '暂无该节点输出数据' : '请在上方选择一个会话以查看详情'}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* 右侧地图主视图 */}
      <div className="relative flex-1 overflow-hidden">
        <TravelMapWithNoSSR
          geojson={geojson}
          styleCode={manifest}
          showHeatmap={showHeatmap}
          forceParams={forceParams}
          fieldParams={fieldParams}
        />
        {showDebugPanel && (
          <ForceParamsPanel
            forceParams={forceParams}
            fieldParams={fieldParams}
            onForceChange={updates => setForceParams(p => ({ ...p, ...updates }))}
            onFieldChange={updates => setFieldParams(p => ({ ...p, ...updates }))}
          />
        )}
      </div>
    </div>
  );
}

export default function AgentPage() {
  return (
    <AgentMapProvider>
      <div className="flex flex-col w-screen h-screen overflow-hidden font-sans">
        <AgentPageContent />
      </div>
    </AgentMapProvider>
  );
}