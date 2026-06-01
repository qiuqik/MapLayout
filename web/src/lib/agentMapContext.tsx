import React, { createContext, useContext, useState, ReactNode } from 'react';

interface StyleManifest {
  Point?: any[];
  Route?: any[];
  Label?: any[];
  Global?: any[];
  _icon_generation?: any;
}

interface AgentMapContextType {
  specfilename: string | null;
  setSpecfilename: (name: string | null) => void;
  manifest: StyleManifest | null;
  setManifest: (spec: StyleManifest | null) => void;
  geojson: any | null;
  setGeojson: (geojson: any | null) => void;
}

const AgentMapContext = createContext<AgentMapContextType | undefined>(undefined);

export const AgentMapProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [specfilename, setSpecfilename] = useState<string | null>(null);
  const [manifest, setManifest] = useState<StyleManifest | null>(null);
  const [geojson, setGeojson] = useState<any | null>(null);

  return (
    <AgentMapContext.Provider value={{ 
      specfilename, 
      setSpecfilename, 
      manifest, 
      setManifest,
      geojson,
      setGeojson
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
