'use client';
import React, { createContext, useState } from 'react';

export type MapContextType = {
  geofilename: string | null;
  setGeofilename: (g: any | null) => void;

  imagename: string | null;
  setImagename: (img: string | null) => void;

  stylename: string | null;
  setStylename: (img: string | null) => void;

};

export const MapDataContext = createContext<MapContextType>({
  geofilename: null,
  setGeofilename: () => {},

  imagename: null,
  setImagename: () => {},

  stylename: null,
  setStylename: () => {},
});

export const MapProvider = ({ children }: { children: React.ReactNode }) => {
  const [geofilename, setGeofilename] = useState<any | null>(null);
  const [imagename, setImagename] = useState<string | null>(null);
  const [stylename, setStylename] = useState<string | null>(null);
  return (
    <MapDataContext.Provider value={{ 
      geofilename, setGeofilename,
      imagename, setImagename,
      stylename, setStylename
      }}>
      {children}
    </MapDataContext.Provider>
  );
};
