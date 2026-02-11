'use client';
import React, { createContext, useState } from 'react';

export type MapContextType = {
  geofilename: any | null;
  geojson: any | null;
  setGeojson: (g: any | null) => void;
  setGeofilename: (g: any | null) => void;
};

export const MapDataContext = createContext<MapContextType>({
  geofilename: null,
  geojson: null,
  setGeojson: () => {},
  setGeofilename: () => {},
});

export const MapProvider = ({ children }: { children: React.ReactNode }) => {
  const [geojson, setGeojson] = useState<any | null>(null);
  const [geofilename, setGeofilename] = useState<any | null>(null);
  return (
    <MapDataContext.Provider value={{ geofilename, geojson, setGeojson, setGeofilename }}>
      {children}
    </MapDataContext.Provider>
  );
};
