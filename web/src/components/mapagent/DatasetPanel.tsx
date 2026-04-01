'use client';

import React, { useState, useCallback } from 'react';
import { useAgentMap } from '@/lib/agentMapContext';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { saveSessionGeojson, saveSessionMapInfo } from '@/lib/api';
import coordtransform from 'coordtransform';
import type { LayoutItemInput, LayoutItemPosition } from '@/app/agent/layout/types';

export type DatasetType = 'origin' | 'layout' | 'groundtruth';

interface DatasetPanelProps {
  onDatasetChange?: (type: DatasetType) => void;
  onRerunLayout?: () => void;
  layoutOutputs?: LayoutItemPosition[];
  layoutInputs?: LayoutItemInput[];
  originPositions?: LayoutItemPosition[];
  groundtruthPositions?: LayoutItemPosition[] | null;
  sessionId?: string;
  currentDataset?: DatasetType;
  geojson?: any;
  mapInfo?: { center: { lng: number; lat: number }; bounds: { north: number; south: number; east: number; west: number } } | null;
}

const DATASET_CONFIG: Record<DatasetType, { label: string; suffix: string; description: string }> = {
  origin: {
    label: 'Original',
    suffix: 'geojson_origin.json',
    description: 'Card/label positions at anchor points (no offset)',
  },
  layout: {
    label: 'Layout',
    suffix: 'geojson_layout.json',
    description: 'Positions after layout algorithm adjustment',
  },
  groundtruth: {
    label: 'Ground Truth',
    suffix: 'geojson_groundtruth.json',
    description: 'Manually adjusted positions via dragging',
  },
};

const DatasetPanel: React.FC<DatasetPanelProps> = ({
  onDatasetChange,
  onRerunLayout,
  layoutOutputs = [],
  layoutInputs = [],
  originPositions = [],
  groundtruthPositions = null,
  sessionId,
  currentDataset: externalDataset,
  geojson: externalGeojson,
  mapInfo,
}) => {
  const { geojson: contextGeojson } = useAgentMap();
  const geojson = externalGeojson ?? contextGeojson;
  const [currentDataset, setCurrentDataset] = useState<DatasetType>('layout');
  const [filename, setFilename] = useState<string>('map_data');
  const [isCapturing, setIsCapturing] = useState(false);

  const activeDataset = externalDataset ?? currentDataset;

  const handleDatasetChange = useCallback((type: DatasetType) => {
    if (!externalDataset) {
      setCurrentDataset(type);
    }
    onDatasetChange?.(type);
    if (type === 'layout') {
      onRerunLayout?.();
    }
  }, [onDatasetChange, onRerunLayout, externalDataset]);

  const toGcj02 = (lng: number, lat: number) => coordtransform.wgs84togcj02(lng, lat);
  const convertMapInfo = (info: typeof mapInfo) => info ? {
    center: { 
      lng: toGcj02(info.center.lng, info.center.lat)[0], 
      lat: toGcj02(info.center.lng, info.center.lat)[1] 
    },
    bounds: { 
      north: toGcj02(info.bounds.east, info.bounds.north)[1], 
      south: toGcj02(info.bounds.west, info.bounds.south)[1], 
      east: toGcj02(info.bounds.east, info.bounds.north)[0], 
      west: toGcj02(info.bounds.west, info.bounds.south)[0] 
    },
  } : null;


  const transformFeatures = (
    features: any[],
    positionMap: Map<string, LayoutItemPosition> | null,
    useOriginCoords: boolean = false
  ) => {
    const inputById = new Map(layoutInputs.map(i => [i.id, i]));

    return features.map((feature: any) => {
      const featureType = feature.geometry?.type;
      const featureName = feature.properties?.name;
      const cardVisualId = feature.properties?.card_visual_id;
      const labelVisualId = feature.properties?.label_visual_id;

      if (!featureName) return feature;

      feature.properties = { ...feature.properties };

      const cardId = cardVisualId !== undefined
        ? `card-${featureType}-${featureName}-${cardVisualId}`
        : `card-${featureType}-${featureName}`;
      const labelId = labelVisualId !== undefined
        ? `label-${featureType}-${featureName}-${labelVisualId}`
        : `label-${featureType}-${featureName}`;

      // if (useOriginCoords) {
      //   feature.properties.card_coord = [...feature.geometry.coordinates];
      //   feature.properties.label_coord = [...feature.geometry.coordinates];
      // } else {
      const cardPos = positionMap?.get(cardId);
      const labelPos = positionMap?.get(labelId);

      const cardInput = inputById.get(cardId);
      const labelInput = inputById.get(labelId);
        
        
      if (cardPos) {
        feature.properties.card_coord = [cardPos.centerLngLat.lng, cardPos.centerLngLat.lat];
        feature.properties.card_coord = toGcj02(feature.properties.card_coord[0], feature.properties.card_coord[1]);
        if (cardInput) {
          feature.properties.card_size = [cardInput.width, cardInput.height];
          console.log("card_size", feature.properties.card_size);
        }
        console.log("cardPos", cardPos);
        console.log("card_coord", feature.properties.card_coord);
      }
      if (labelPos) {
        feature.properties.label_coord = [labelPos.centerLngLat.lng, labelPos.centerLngLat.lat];
        feature.properties.label_coord = toGcj02(feature.properties.label_coord[0], feature.properties.label_coord[1]);
        if (labelInput) {
          feature.properties.label_size = [labelInput.width, labelInput.height];
          console.log("label_size", feature.properties.label_size);
        }
        console.log("labelPos", labelPos);
        console.log("label_coord", feature.properties.label_coord);
      }
      // }

     

      return feature;
    });
  };

  const saveToSession = useCallback(async () => {
    if (!sessionId) {
      alert('No valid session ID available');
      return;
    }

    setIsCapturing(true);
    try {
      const originRes = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000'}/api/multimodal/session/${sessionId}`);
      const sessionData = await originRes.json();

      if (!sessionData.origin_file?.data) {
        alert('No origin geojson found in session');
        setIsCapturing(false);
        return;
      }

      const baseGeojson = sessionData.origin_file.data;
      const transformed = JSON.parse(JSON.stringify(baseGeojson));

      let positionMap: Map<string, LayoutItemPosition> | null = null;
      let useOriginCoords = false;

      if (activeDataset === 'origin') {
        // useOriginCoords = true;
        positionMap = new Map(originPositions.map(p => [p.id, p]));
      } else if (activeDataset === 'layout' && layoutOutputs.length > 0) {
        positionMap = new Map(layoutOutputs.map(o => [o.id, o]));
      } else if (activeDataset === 'groundtruth' && groundtruthPositions && groundtruthPositions.length > 0) {
        positionMap = new Map(groundtruthPositions.map(p => [p.id, p]));
      }

      if (useOriginCoords || positionMap) {
        transformed.features = transformFeatures(transformed.features, positionMap, useOriginCoords);
      }

      const [geojsonResult, mapInfoResult] = await Promise.all([
        saveSessionGeojson({
          sessionId,
          geojson: transformed,
          filename: `${filename}_${DATASET_CONFIG[activeDataset].suffix}`,
          category: activeDataset,
        }),
        mapInfo ? saveSessionMapInfo({ sessionId, mapInfo: convertMapInfo(mapInfo) }) : Promise.resolve({ success: false }),
        // mapInfo ? saveSessionMapInfo({ sessionId, mapInfo }) : Promise.resolve({ success: false }),
      ]);

      if (geojsonResult.success) {
        const messages = ['Dataset saved'];
        if (mapInfoResult.success) messages.push('MapInfo saved');
        alert(messages.join('\n'));
      } else {
        alert(`Error saving: ${geojsonResult.error}`);
      }
    } catch (error) {
      console.error('Error saving dataset to session:', error);
      alert('Error saving dataset to session');
    } finally {
      setIsCapturing(false);
    }
  }, [activeDataset, sessionId, layoutOutputs, layoutInputs, groundtruthPositions, mapInfo, filename]);

  return (
    <div className="flex flex-col h-full">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Dataset Generation</h3>

      <div className="space-y-1.5 flex flex-col">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Dataset Type</label>
          <div className="flex gap-2">
            {(Object.entries(DATASET_CONFIG) as [DatasetType, typeof DATASET_CONFIG[DatasetType]][]).map(([key, config]) => (
              <button
                key={key}
                onClick={() => handleDatasetChange(key)}
                className={`flex-1 text-[11px] px-2 py-1 rounded-md border font-semibold transition-all text-center ${
                  activeDataset === key
                    ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium'
                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                }`}
              >
                {config.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Filename</label>
          <textarea
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            placeholder="your filename"
            className="w-full h-8 p-2 text-[10px] border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-gray-800/50 overflow-hidden"
          />
        </div>

        <div className="pl-3 py-2 bg-amber-50 rounded-md border border-amber-100">
          <p className="text-[10px] text-amber-600">
            Output File: <span className="font-mono font-medium">{filename}_{DATASET_CONFIG[activeDataset].suffix}</span>
          </p>
        </div>

        {sessionId && (
          <Button
            className="w-full h-8 my-2 text-[12px]"
            onClick={saveToSession}
            disabled={isCapturing || !geojson}
            variant="outline"
          >
            {isCapturing ? 'Saving...' : 'Save to Session'}
          </Button>
        )}

        <Separator />

        <div className="space-y-2">
          <p className="text-xs text-gray-500">Dataset Description:</p>
          <div className="space-y-2">
            {Object.entries(DATASET_CONFIG).map(([key, config]) => (
              <div
                key={key}
                className={`p-2 rounded-md border text-[10px] ${
                  activeDataset === key
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'bg-gray-50 border-gray-100 text-gray-600'
                }`}
              >
                <p className="font-medium">{config.label}</p>
                <p className="mt-0.5">{config.description}</p>
                <p className="mt-0.5 text-gray-400 font-mono">{config.suffix}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DatasetPanel;