'use client';

import React, { useState, useCallback } from 'react';
import { useAgentMap } from '@/lib/agentMapContext';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import coordtransform from 'coordtransform';

export type DatasetType = 'origin' | 'layout' | 'groundtruth';

interface DatasetPanelProps {
  onDatasetChange?: (type: DatasetType) => void;
}

const DATASET_CONFIG: Record<DatasetType, { label: string; suffix: string; description: string }> = {
  origin: {
    label: 'Original',
    suffix: 'geojson_origin.json',
    description: 'Positions of card/label positions relative to anchors',
  },
  layout: {
    label: 'Layout',
    suffix: 'geojson_layout.json',
    description: 'Positions after layout algorithm adjustment',
  },
  groundtruth: {
    label: 'Ground Truth',
    suffix: 'geojson_groundtruth.json',
    description: 'Ground truth positions after human adjustment',
  },
};

const DatasetPanel: React.FC<DatasetPanelProps> = ({ onDatasetChange }) => {
  const { geojson } = useAgentMap();
  const [currentDataset, setCurrentDataset] = useState<DatasetType>('origin');
  const [filename, setFilename] = useState<string>('map_data');
  const [isCapturing, setIsCapturing] = useState(false);

  const handleDatasetChange = useCallback((type: DatasetType) => {
    setCurrentDataset(type);
    onDatasetChange?.(type);
  }, [onDatasetChange]);

  const saveDataset = useCallback(async () => {
    if (!geojson) {
      alert('No valid geojson data available');
      return;
    }

    setIsCapturing(true);
    try {
      const config = DATASET_CONFIG[currentDataset];
      const fullFilename = `${filename}_${config.suffix}`;

      const layoutPositions = new Map();
      if (currentDataset === 'layout') {
        geojson.features?.forEach((f: any) => {
          if (f.properties?.card_coord) {
            const [lng, lat] = f.properties.card_coord;
            layoutPositions.set(`card-point-${f.properties?.name}`, { lng, lat });
          }
          if (f.properties?.label_coord) {
            const [lng, lat] = f.properties.label_coord;
            layoutPositions.set(`label-point-${f.properties?.name}`, { lng, lat });
          }
        });
      }

      const transformed = JSON.parse(JSON.stringify(geojson));
      transformed.features = transformed.features.map((feature: any) => {
        if (feature.geometry?.type === 'Point') {
          const wgs84Coord = coordtransform.gcj02towgs84(...feature.geometry.coordinates);
          feature.properties = feature.properties || {};
          feature.properties.coordinates = wgs84Coord;

          if (currentDataset === 'layout') {
            const cardKey = `card-point-${feature.properties?.name}`;
            const labelKey = `label-point-${feature.properties?.name}`;
            const cardPos = layoutPositions.get(cardKey);
            const labelPos = layoutPositions.get(labelKey);

            if (cardPos) {
              const gcj02Card = coordtransform.wgs84togcj02(cardPos.lng, cardPos.lat);
              feature.properties.card_coord = gcj02Card;
            }
            if (labelPos) {
              const gcj02Label = coordtransform.wgs84togcj02(labelPos.lng, labelPos.lat);
              feature.properties.label_coord = gcj02Label;
            }
          }
        }
        return feature;
      });

      const blob = new Blob([JSON.stringify(transformed, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fullFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      alert(`Dataset saved as GeoJSON file: ${fullFilename}`);
    } catch (error) {
      console.error('Error saving dataset:', error);
      alert('Error saving dataset');
    } finally {
      setIsCapturing(false);
    }
  }, [geojson, currentDataset, filename]);

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
                  currentDataset === key
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
          {/* <Input
            className="h-8 text-gray-700 ![font-size:12px] px-2 leading-none"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            placeholder="Input filename"
          /> */}
          <textarea
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            placeholder="your filename"
            className="w-full h-8 p-2 text-[10px] border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-gray-800/50 overflow-hidden"
          />
        </div>

        <div className="pl-3 py-2 bg-amber-50 rounded-md border border-amber-100">
          <p className="text-[10px] text-amber-600">
            Output File: <span className="font-mono font-medium">{filename}_{DATASET_CONFIG[currentDataset].suffix}</span>
          </p>
        </div>

        <Button
          className="w-full h-8 my-2 text-[12px]"
          onClick={saveDataset}
          disabled={isCapturing || !geojson}
          variant="outline"
        >
          {isCapturing ? 'Saving...' : 'Export as GeoJSON'}
        </Button>

        <Separator />

        <div className="space-y-2">
          <p className="text-xs text-gray-500">Dataset Description:</p>
          <div className="space-y-2">
            {Object.entries(DATASET_CONFIG).map(([key, config]) => (
              <div
                key={key}
                className={`p-2 rounded-md border text-[10px] ${
                  currentDataset === key
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