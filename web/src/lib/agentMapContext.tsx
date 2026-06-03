import React, { createContext, useCallback, useContext, useState, ReactNode } from 'react';

interface StyleManifest {
  Point?: any[];
  Route?: any[];
  Label?: any[];
  Global?: any[];
  _icon_generation?: any;
}

export interface AgentRunEvent {
  type: string;
  run_id: string;
  session_id?: string | null;
  node_id?: string | null;
  label?: string | null;
  status?: string | null;
  payload?: Record<string, any>;
  timestamp?: string;
}

export interface AgentSelection {
  kind: 'agent_event' | 'agent_output' | 'map_feature';
  event?: AgentRunEvent;
  node_id?: string | null;
  outputKey?: string;
  label?: string | null;
  payload?: Record<string, any>;
}

interface AgentMapContextType {
  specfilename: string | null;
  setSpecfilename: (name: string | null) => void;
  manifest: StyleManifest | null;
  setManifest: (spec: StyleManifest | null) => void;
  geojson: any | null;
  setGeojson: (geojson: any | null) => void;
  visualStructure: any | null;
  setVisualStructure: (visualStructure: any | null) => void;
  agentEvents: AgentRunEvent[];
  setAgentEvents: (events: AgentRunEvent[]) => void;
  appendAgentEvent: (event: AgentRunEvent) => void;
  clearAgentEvents: () => void;
  activeRunId: string | null;
  setActiveRunId: (runId: string | null) => void;
  isAgentRunning: boolean;
  setIsAgentRunning: (running: boolean) => void;
  selectedAgentEvent: AgentRunEvent | null;
  setSelectedAgentEvent: (event: AgentRunEvent | null) => void;
  selectedAgentSelection: AgentSelection | null;
  setSelectedAgentSelection: (selection: AgentSelection | null) => void;
}

const AgentMapContext = createContext<AgentMapContextType | undefined>(undefined);

export const AgentMapProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [specfilename, setSpecfilename] = useState<string | null>(null);
  const [manifest, setManifest] = useState<StyleManifest | null>(null);
  const [geojson, setGeojson] = useState<any | null>(null);
  const [visualStructure, setVisualStructure] = useState<any | null>(null);
  const [agentEvents, setAgentEvents] = useState<AgentRunEvent[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [selectedAgentEvent, setSelectedAgentEvent] = useState<AgentRunEvent | null>(null);
  const [selectedAgentSelection, setSelectedAgentSelection] = useState<AgentSelection | null>(null);
  const selectAgentEvent = useCallback((event: AgentRunEvent | null) => {
    setSelectedAgentEvent(event);
    setSelectedAgentSelection(event ? { kind: 'agent_event', event, node_id: event.node_id, label: event.label, payload: event.payload } : null);
  }, []);
  const appendAgentEvent = useCallback((event: AgentRunEvent) => {
    setAgentEvents((events) => [...events, event]);
  }, []);
  const clearAgentEvents = useCallback(() => setAgentEvents([]), []);

  return (
    <AgentMapContext.Provider value={{ 
      specfilename, 
      setSpecfilename, 
      manifest, 
      setManifest,
      geojson,
      setGeojson,
      visualStructure,
      setVisualStructure,
      agentEvents,
      setAgentEvents,
      appendAgentEvent,
      clearAgentEvents,
      activeRunId,
      setActiveRunId,
      isAgentRunning,
      setIsAgentRunning,
      selectedAgentEvent,
      setSelectedAgentEvent: selectAgentEvent,
      selectedAgentSelection,
      setSelectedAgentSelection,
    }}>
      {children}
    </AgentMapContext.Provider>
  );
};

export const useAgentMap = () => {
  const context = useContext(AgentMapContext);
  if (!context) {
    throw new Error('useAgentMap must be used within an AgentMapProvider');
  }
  return context;
};
