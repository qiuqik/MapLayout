'use client';

import React, { useEffect, useState } from 'react';
import AgentDialog from '@/components/mapagent/AgentDialog';
import { AgentMapProvider, useAgentMap } from '@/lib/agentMapContext';
import { Separator } from '@/components/ui/separator';
import dynamic from 'next/dynamic';
import ForceParamsPanel, { type ForceParamsOverride, type FieldParamsOverride } from '@/components/mapagent/ForceParamsPanel';

const TravelMapWithNoSSR = dynamic(
  () => import('@/components/mapagent/TravelMap'),
  { ssr: false }
);

const DEFAULT_FORCE_OVERRIDE: ForceParamsOverride = {
  linkStrength: 0.16,
  lift: 22,
  collideStrength: 3.5,
  fieldStrength: 1.8,
  iterations: 360,
  leaderThreshold: 28,
};

const DEFAULT_FIELD_OVERRIDE: FieldParamsOverride = {
  sigma: 28,
  strength: 1400,
  obstaclePadding: 6,
  cellSize: 24,
};

function AgentPageContent() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [currentSession, setCurrentSession] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<string>('node1');
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [forceParams, setForceParams] = useState<ForceParamsOverride>({ ...DEFAULT_FORCE_OVERRIDE });
  const [fieldParams, setFieldParams] = useState<FieldParamsOverride>({ ...DEFAULT_FIELD_OVERRIDE });
  const { setSpecfilename, setManifest, setGeojson, manifest, geojson } = useAgentMap();

  const loadSession = async (sessionId: string) => {
    try {
      const res = await fetch(`http://localhost:8000/api/multimodal/session/${sessionId}`);
      const data = await res.json();
      
      setCurrentSession(data);
      
      if (data.geojson) {
        setGeojson(data.geojson);
      }
      
      if (data.style_code) {
        setManifest(data.style_code);
      }
    } catch (error) {
      console.error('加载会话失败:', error);
    }
  };

  useEffect(() => {
    fetch('http://localhost:8000/api/multimodal/sessions')
      .then(res => res.json())
      .then(data => {
        const sessionList = data.sessions || [];
        setSessions(sessionList);
        if (sessionList.length > 0) {
          loadSession(sessionList[0].session_id);
        }
      })
      .catch(err => console.error(err));
  }, []);

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex flex-col flex-shrink-0 w-[21%] h-full bg-white shadow-lg p-4 z-10">
        <div className="sticky top-0 z-10 mb-4">
          <h1 className="text-lg font-semibold">AgentMapLayout</h1>
        </div>
        
        <AgentDialog />
        
        <Separator className="my-4" />
        
        <h3 className="text-sm font-medium mb-1">Historical Sessions</h3>
        <div className="mt-2 h-32 overflow-auto">
          {sessions.length === 0 && <div className="text-xs text-gray-500">No sessions</div>}
          <ul className="space-y-1">
            {sessions.map(s => (
              <li key={s.session_id}>
                <button
                  className="w-full text-sm text-left px-2 py-1 rounded hover:bg-gray-100 truncate"
                  onClick={() => loadSession(s.session_id)}
                >
                  {s.session_id}
                </button>
              </li>
            ))}
          </ul>
        </div>
        
        <Separator className="my-4" />

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => setShowHeatmap(v => !v)}
            style={{
              flex: 1,
              padding: '5px 8px',
              borderRadius: 6,
              border: `1.5px solid ${showHeatmap ? '#f59e0b' : '#d1d5db'}`,
              background: showHeatmap ? '#fffbeb' : '#f9fafb',
              color: showHeatmap ? '#b45309' : '#374151',
              fontWeight: 600,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {showHeatmap ? '🟠 Heatmap ON' : '🌡 Heatmap'}
          </button>
          <button
            onClick={() => setShowDebugPanel(v => !v)}
            style={{
              flex: 1,
              padding: '5px 8px',
              borderRadius: 6,
              border: `1.5px solid ${showDebugPanel ? '#3b82f6' : '#d1d5db'}`,
              background: showDebugPanel ? '#eff6ff' : '#f9fafb',
              color: showDebugPanel ? '#1d4ed8' : '#374151',
              fontWeight: 600,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {showDebugPanel ? '🔵 Debug ON' : '⚙ Debug'}
          </button>
        </div>

        <Separator className="my-4" />

        <div className="flex-1 flex flex-col overflow-hidden">
          <h3 className="text-sm font-medium mb-2">Node Outputs</h3>
          
          <div className="flex border-b">
            <button 
              className={`flex-1 text-xs py-1 px-2 ${activeTab === 'node1' ? 'border-b-2 border-blue-500 text-blue-500' : 'text-gray-500'}`}
              onClick={() => setActiveTab('node1')}
            >
              Intent Recognition
            </button>
            <button 
              className={`flex-1 text-xs py-1 px-2 ${activeTab === 'node2' ? 'border-b-2 border-blue-500 text-blue-500' : 'text-gray-500'}`}
              onClick={() => setActiveTab('node2')}
            >
              Visual Structure
            </button>
            <button 
              className={`flex-1 text-xs py-1 px-2 ${activeTab === 'node3' ? 'border-b-2 border-blue-500 text-blue-500' : 'text-gray-500'}`}
              onClick={() => setActiveTab('node3')}
            >
              Geo Data
            </button>
            <button 
              className={`flex-1 text-xs py-1 px-2 ${activeTab === 'node4' ? 'border-b-2 border-blue-500 text-blue-500' : 'text-gray-500'}`}
              onClick={() => setActiveTab('node4')}
            >
              Style Code
            </button>
          </div>
          
          <div className="flex-1 overflow-auto mt-2 text-xs">
            {currentSession && activeTab === 'node1' && (
              <div className="p-2 bg-gray-50 rounded">
                <pre className="whitespace-pre-wrap">{JSON.stringify(currentSession.node1, null, 2)}</pre>
              </div>
            )}
            
            {currentSession && activeTab === 'node2' && (
              <div className="p-2 bg-gray-50 rounded">
                <pre className="whitespace-pre-wrap">{JSON.stringify(currentSession.node2, null, 2)}</pre>
              </div>
            )}
            
            {currentSession && activeTab === 'node3' && (
              <div className="p-2 bg-gray-50 rounded">
                <pre className="whitespace-pre-wrap">{JSON.stringify(currentSession.node3, null, 2)}</pre>
              </div>
            )}
            
            {currentSession && activeTab === 'node4' && (
              <div className="p-2 bg-gray-50 rounded">
                <pre className="whitespace-pre-wrap">{JSON.stringify(currentSession.node4, null, 2)}</pre>
              </div>
            )}
            
            {!currentSession && (
              <div className="p-2 text-gray-500">Select a session to view node outputs</div>
            )}
          </div>
        </div>

      </div>
      
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
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
      <div className="flex flex-col w-screen h-screen overflow-hidden">
        <AgentPageContent />
      </div>
    </AgentMapProvider>
  );
}
