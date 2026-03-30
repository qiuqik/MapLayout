'use client';

import React, { useState, useCallback } from 'react';
import { useAgentMap } from '@/lib/agentMapContext';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { saveSessionGeojson } from '@/lib/api';
import coordtransform from 'coordtransform';
import type { LayoutItemInput, LayoutItemPosition } from '@/app/agent/layout/types';

export type DatasetType = 'origin' | 'layout' | 'groundtruth';

interface DatasetPanelProps {
  onDatasetChange?: (type: DatasetType) => void;
  onRerunLayout?: () => void;
  layoutOutputs?: LayoutItemPosition[];
  layoutInputs?: LayoutItemInput[];
  groundtruthPositions?: LayoutItemPosition[] | null;
  sessionId?: string;
  currentDataset?: DatasetType;
  geojson?: any;
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
  groundtruthPositions = null,
  sessionId,
  currentDataset: externalDataset,
  geojson: externalGeojson,
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

      if (activeDataset === 'origin') {
        transformed.features = transformed.features.map((feature: any) => {
          if (feature.geometry?.type === 'Point') {
            const wgs84Coord = coordtransform.gcj02towgs84(...feature.geometry.coordinates);
            feature.properties = feature.properties || {};
            feature.properties.coordinates = wgs84Coord;
            feature.properties.card_coord = [...feature.geometry.coordinates];
            feature.properties.label_coord = [...feature.geometry.coordinates];
          }
          return feature;
        });
      }

      if (activeDataset === 'layout' && layoutOutputs.length > 0) {
        const outputById = new Map(layoutOutputs.map(o => [o.id, o]));

        transformed.features = transformed.features.map((feature: any) => {
          const featureType = feature.geometry?.type;
          const featureName = feature.properties?.name;
          const cardVisualId = feature.properties?.card_visual_id;
          const labelVisualId = feature.properties?.label_visual_id;
          
          if (!featureName) return feature;

          feature.properties = feature.properties || {};

          if (featureType === 'Point') {
            const wgs84Coord = coordtransform.gcj02towgs84(...feature.geometry.coordinates);
            feature.properties.coordinates = wgs84Coord;
          }

          const cardId = cardVisualId !== undefined 
            ? `card-${featureType}-${featureName}-${cardVisualId}` 
            : `card-${featureType}-${featureName}`;
          const labelId = labelVisualId !== undefined 
            ? `label-${featureType}-${featureName}-${labelVisualId}` 
            : `label-${featureType}-${featureName}`;

          const cardOutput = outputById.get(cardId);
          const labelOutput = outputById.get(labelId);

          if (cardOutput) {
            const gcj02Card = coordtransform.wgs84togcj02(cardOutput.centerLngLat.lng, cardOutput.centerLngLat.lat);
            feature.properties.card_coord = gcj02Card;
          }

          if (labelOutput) {
            const gcj02Label = coordtransform.wgs84togcj02(labelOutput.centerLngLat.lng, labelOutput.centerLngLat.lat);
            feature.properties.label_coord = gcj02Label;
          }

          return feature;
        });
      }

      if (activeDataset === 'groundtruth' && groundtruthPositions && groundtruthPositions.length > 0) {
        const gtPosMap = new Map(groundtruthPositions.map(p => [p.id, p]));
        
        transformed.features = transformed.features.map((feature: any) => {
          const featureType = feature.geometry?.type;
          const featureName = feature.properties?.name;
          const cardVisualId = feature.properties?.card_visual_id;
          const labelVisualId = feature.properties?.label_visual_id;
          
          if (!featureName) return feature;

          feature.properties = feature.properties || {};

          if (featureType === 'Point') {
            const wgs84Coord = coordtransform.gcj02towgs84(...feature.geometry.coordinates);
            feature.properties.coordinates = wgs84Coord;
          }

          const cardId = cardVisualId !== undefined 
            ? `card-${featureType}-${featureName}-${cardVisualId}` 
            : `card-${featureType}-${featureName}`;
          const labelId = labelVisualId !== undefined 
            ? `label-${featureType}-${featureName}-${labelVisualId}` 
            : `label-${featureType}-${featureName}`;

          const cardPos = gtPosMap.get(cardId);
          const labelPos = gtPosMap.get(labelId);

          if (cardPos) {
            const gcj02Card = coordtransform.wgs84togcj02(cardPos.centerLngLat.lng, cardPos.centerLngLat.lat);
            feature.properties.card_coord = gcj02Card;
          }
          if (labelPos) {
            const gcj02Label = coordtransform.wgs84togcj02(labelPos.centerLngLat.lng, labelPos.centerLngLat.lat);
            feature.properties.label_coord = gcj02Label;
          }
          
          return feature;
        });
      }

      const result = await saveSessionGeojson({
        sessionId,
        geojson: transformed,
        filename: `${filename}_${DATASET_CONFIG[activeDataset].suffix}`,
        category: activeDataset,
      });
      if (result.success) {
        alert(`Dataset saved to session: ${result.filepath || sessionId}`);
      } else {
        alert(`Error saving to session: ${result.error}`);
      }
    } catch (error) {
      console.error('Error saving dataset to session:', error);
      alert('Error saving dataset to session');
    } finally {
      setIsCapturing(false);
    }
  }, [activeDataset, sessionId, layoutOutputs, layoutInputs, groundtruthPositions]);

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
            {isCapturing ? 'Saving...' : 'Save GeoJson to Session'}
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