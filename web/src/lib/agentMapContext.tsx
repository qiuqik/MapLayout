import React, { createContext, useCallback, useContext, useState, ReactNode } from 'react';

interface StyleManifest {
  Point?: any[];
  Route?: any[];
  Label?: any[];
  Global?: any[];
  _icon_generation?: any;
  _navigation_status?: Record<string, any>;
}

export type AgentWorkspaceMode = 'preview' | 'edit' | 'code';

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
  kind: 'agent_event' | 'map_feature';
  event?: AgentRunEvent;
  node_id?: string | null;
  label?: string | null;
  payload?: Record<string, any>;
}

export type RevisionScope =
  | { type: 'global'; allowedTargets?: string[]; allowedProperties?: string[] }
  | { type: 'node'; nodeId: string; allowedTargets?: string[]; allowedProperties?: string[] }
  | { type: 'element'; elementId: string; elementType: 'label' | 'route' | 'poi' | 'area'; allowedProperties?: string[] };

export type LabelLayoutItem = {
  id: string;
  text: string;
  poiId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  zoomLevel?: number;
  hierarchy: 'primary' | 'secondary' | 'detail';
  visible: boolean;
  locked?: boolean;
  manuallyEdited?: boolean;
  overlapState?: {
    hasOverlap: boolean;
    overlappingWith?: string[];
  };
  anchor?: { x: number; y: number };
  bbox?: { left: number; top: number; right: number; bottom: number };
};

export type ManualEditSource = 'manual_drag' | 'inspector_edit' | 'chat_request';

export type ManualEditState = {
  lockedElements: string[];
  editedProperties: Record<string, {
    properties: string[];
    timestamp: string;
    source: ManualEditSource;
  }>;
  preserveManualEdits: boolean;
};

export type ConversationMessage = {
  id: string;
  role: 'user' | 'agent';
  text: string;
  timestamp: string;
  scope?: RevisionScope;
};

export type RevisionJob = {
  id: string;
  request: string;
  scope: RevisionScope;
  status: 'Queued' | 'Analyzing' | 'Revising' | 'Validating' | 'Passed' | 'Needs Revision' | 'Failed';
  affectedObjects: string[];
  currentStep: string;
  proposedChanges: string[];
  timestamp: string;
};

export type VersionCard = {
  id: string;
  title: string;
  summary: string;
  createdAt: string;
  sessionId?: string;
  author?: string;
  status: 'Current' | 'Completed' | 'In Progress' | 'Failed';
  thumbnailUrl?: string;
};

export const defaultManualEditState: ManualEditState = {
  lockedElements: [],
  editedProperties: {},
  preserveManualEdits: true,
};

export const downstreamNodesForRerun = (nodeId?: string | null): { node_id: string; label: string }[] => {
  if (nodeId === 'intent') {
    return [
      { node_id: 'geojson', label: 'GeoJSON generation' },
      { node_id: 'validation', label: 'Validation' },
      { node_id: 'style', label: 'Style generation' },
    ];
  }
  if (nodeId === 'visual') {
    return [{ node_id: 'style', label: 'Style generation' }];
  }
  if (nodeId === 'geojson') {
    return [
      { node_id: 'validation', label: 'Validation' },
      { node_id: 'style', label: 'Style generation' },
    ];
  }
  if (nodeId === 'style' || nodeId === 'icon_generation') {
    return [{ node_id: 'style', label: 'Style generation' }];
  }
  if (nodeId === 'workflow_completed') {
    return [
      { node_id: 'validation', label: 'Validation' },
      { node_id: 'style', label: 'Style generation' },
    ];
  }
  return [];
};

export const shouldAutoSelectAgentEvent = (event: AgentRunEvent) => (
  event.type === 'node_started' ||
  event.type === 'node_completed' ||
  event.type === 'node_validation' ||
  event.type === 'workflow_error'
);

export const replayAgentEvents = async (
  events: AgentRunEvent[],
  appendAgentEvent: (event: AgentRunEvent) => void,
  setSelectedAgentEvent?: (event: AgentRunEvent) => void,
) => {
  for (const event of events) {
    appendAgentEvent(event);
    if (setSelectedAgentEvent && shouldAutoSelectAgentEvent(event)) {
      setSelectedAgentEvent(event);
    }
    const delay = event.type === 'artifact_saved' ? 50 : 260;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
};

interface AgentMapContextType {
  mode: AgentWorkspaceMode;
  setMode: (mode: AgentWorkspaceMode) => void;
  specfilename: string | null;
  setSpecfilename: (name: string | null) => void;
  manifest: StyleManifest | null;
  setManifest: React.Dispatch<React.SetStateAction<StyleManifest | null>>;
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
  conversationMessages: ConversationMessage[];
  setConversationMessages: React.Dispatch<React.SetStateAction<ConversationMessage[]>>;
  revisionJobs: RevisionJob[];
  setRevisionJobs: React.Dispatch<React.SetStateAction<RevisionJob[]>>;
  versionCards: VersionCard[];
  setVersionCards: React.Dispatch<React.SetStateAction<VersionCard[]>>;
  labelLayout: LabelLayoutItem[];
  setLabelLayout: React.Dispatch<React.SetStateAction<LabelLayoutItem[]>>;
  manualEditState: ManualEditState;
  setManualEditState: React.Dispatch<React.SetStateAction<ManualEditState>>;
  recordManualEdit: (elementId: string, properties: string[], source: ManualEditSource) => void;
  captureMapScreenshot: (() => Promise<string>) | null;
  setCaptureMapScreenshot: (capture: (() => Promise<string>) | null) => void;
}

const AgentMapContext = createContext<AgentMapContextType | undefined>(undefined);

export const AgentMapProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [mode, setMode] = useState<AgentWorkspaceMode>('edit');
  const [specfilename, setSpecfilename] = useState<string | null>(null);
  const [manifest, setManifest] = useState<StyleManifest | null>(null);
  const [geojson, setGeojson] = useState<any | null>(null);
  const [visualStructure, setVisualStructure] = useState<any | null>(null);
  const [agentEvents, setAgentEvents] = useState<AgentRunEvent[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [selectedAgentEvent, setSelectedAgentEvent] = useState<AgentRunEvent | null>(null);
  const [selectedAgentSelection, setSelectedAgentSelection] = useState<AgentSelection | null>(null);
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [revisionJobs, setRevisionJobs] = useState<RevisionJob[]>([]);
  const [versionCards, setVersionCards] = useState<VersionCard[]>([]);
  const [labelLayout, setLabelLayout] = useState<LabelLayoutItem[]>([]);
  const [manualEditState, setManualEditState] = useState<ManualEditState>(defaultManualEditState);
  const [captureMapScreenshot, setCaptureMapScreenshotState] = useState<(() => Promise<string>) | null>(null);
  const selectAgentEvent = useCallback((event: AgentRunEvent | null) => {
    setSelectedAgentEvent(event);
    setSelectedAgentSelection(event ? { kind: 'agent_event', event, node_id: event.node_id, label: event.label, payload: event.payload } : null);
  }, []);
  const appendAgentEvent = useCallback((event: AgentRunEvent) => {
    setAgentEvents((events) => [...events, event]);
  }, []);
  const clearAgentEvents = useCallback(() => setAgentEvents([]), []);
  const recordManualEdit = useCallback((elementId: string, properties: string[], source: ManualEditSource) => {
    if (!elementId || properties.length === 0) return;
    setManualEditState((current) => {
      const existing = current.editedProperties[elementId]?.properties || [];
      return {
        ...current,
        editedProperties: {
          ...current.editedProperties,
          [elementId]: {
            properties: Array.from(new Set([...existing, ...properties])),
            timestamp: new Date().toISOString(),
            source,
          },
        },
      };
    });
  }, []);
  const setCaptureMapScreenshot = useCallback((capture: (() => Promise<string>) | null) => {
    setCaptureMapScreenshotState(() => capture);
  }, []);

  return (
    <AgentMapContext.Provider value={{ 
      mode,
      setMode,
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
      conversationMessages,
      setConversationMessages,
      revisionJobs,
      setRevisionJobs,
      versionCards,
      setVersionCards,
      labelLayout,
      setLabelLayout,
      manualEditState,
      setManualEditState,
      recordManualEdit,
      captureMapScreenshot,
      setCaptureMapScreenshot,
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
