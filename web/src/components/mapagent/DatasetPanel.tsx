'use client';

import React, { useState, useCallback } from 'react';
import { useAgentMap } from '@/lib/agentMapContext';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { saveSessionGeojson, saveSessionMapInfo } from '@/lib/api';
import type { LayoutItemInput, LayoutItemPosition, LayoutRunMetadata } from '@/app/agent/layout/types';
import { getFeatureLabelId } from './utils/mapUtils';

export type DatasetType = 'origin' | 'layout' | 'groundtruth';
export type LayoutAlgorithm = 'force' | 'simulatedAnnealing' | 'weightedVoronoiDirect' | 'weightedVoronoi';

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
  layoutAlgorithm?: LayoutAlgorithm;
  layoutSeed?: number;
  layoutRunMetadata?: LayoutRunMetadata | null;
  onLayoutAlgorithmChange?: (algorithm: LayoutAlgorithm) => void;
  onLayoutSeedChange?: (seed: number) => void;
}

const DATASET_CONFIG: Record<DatasetType, { label: string; suffix: string; description: string }> = {
  origin: {
    label: 'Original',
    suffix: 'geojson_origin.json',
    description: 'Label positions at anchor points (no offset)',
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
  layoutAlgorithm: externalAlgorithm,
  layoutSeed = 1,
  layoutRunMetadata,
  onLayoutAlgorithmChange,
  onLayoutSeedChange,
}) => {
  const { geojson: contextGeojson } = useAgentMap();
  const geojson = externalGeojson ?? contextGeojson;
  const [currentDataset, setCurrentDataset] = useState<DatasetType>('layout');
  const [currentAlgorithm, setCurrentAlgorithm] = useState<LayoutAlgorithm>('force');
  const [filename, setFilename] = useState<string>('map_data');
  const [isCapturing, setIsCapturing] = useState(false);

  const activeDataset = externalDataset ?? currentDataset;
  const activeAlgorithm = externalAlgorithm ?? currentAlgorithm;

  const handleDatasetChange = useCallback((type: DatasetType) => {
    if (!externalDataset) {
      setCurrentDataset(type);
    }
    onDatasetChange?.(type);
    if (type === 'layout') {
      onRerunLayout?.();
    }
  }, [onDatasetChange, onRerunLayout, externalDataset]);

  const handleAlgorithmChange = useCallback((algorithm: LayoutAlgorithm) => {
    if (!externalAlgorithm) {
      setCurrentAlgorithm(algorithm);
    }
    onLayoutAlgorithmChange?.(algorithm);
    onRerunLayout?.();
  }, [onLayoutAlgorithmChange, externalAlgorithm, onRerunLayout]);

  const handleSeedChange = useCallback((value: string) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return;
    onLayoutSeedChange?.(Math.min(4294967295, Math.max(1, parsed)));
  }, [onLayoutSeedChange]);

  const convertMapInfo = (info: typeof mapInfo) => info ? {
    center: {
      lng: info.center.lng,
      lat: info.center.lat
    },
    bounds: {
      north: info.bounds.north,
      south: info.bounds.south,
      east: info.bounds.east,
      west: info.bounds.west
    },
  } : null;


  const transformFeatures = (
    features: any[],
    positionMap: Map<string, LayoutItemPosition> | null
  ) => {
    const inputById = new Map(layoutInputs.map(i => [i.id, i]));

    return features.map((feature: any) => {
      const featureType = feature.geometry?.type;

      if (featureType !== 'Point') return feature;
      if (!feature.properties?.label_title && !feature.properties?.name) return feature;

      feature.properties = { ...feature.properties };

      const labelId = getFeatureLabelId(feature);
      const labelPos = positionMap?.get(labelId);
      const labelInput = inputById.get(labelId);

      if (labelPos) {
        feature.properties.label_coord = [labelPos.centerLngLat.lng, labelPos.centerLngLat.lat];
        if (labelInput) {
          feature.properties.label_size = [labelInput.width, labelInput.height];
          console.log("label_size", feature.properties.label_size);
        }
        console.log("labelPos", labelPos);
        console.log("label_coord", feature.properties.label_coord);
      }

      return feature;
    });
  };

  const saveToSession = useCallback(async () => {
    if (!sessionId) {
      alert('No valid session ID available');
      return;
    }
    if (!geojson) {
      alert('No geojson data available');
      return;
    }

    setIsCapturing(true);
    try {
      // 直接使用前端当前的 geojson（包含完整的 LineString）
      const baseGeojson = JSON.parse(JSON.stringify(geojson));

      let positionMap: Map<string, LayoutItemPosition> | null = null;
      if (activeDataset === 'origin') {
        positionMap = new Map(originPositions.map(p => [p.id, p]));
      } else if (activeDataset === 'layout' && layoutOutputs.length > 0) {
        positionMap = new Map(layoutOutputs.map(o => [o.id, o]));
      } else if (activeDataset === 'groundtruth' && groundtruthPositions && groundtruthPositions.length > 0) {
        positionMap = new Map(groundtruthPositions.map(p => [p.id, p]));
      }

      // 只更新 label_coord，LineString 保持不变
      if (positionMap) {
        baseGeojson.features = transformFeatures(baseGeojson.features, positionMap);
      }

      if (activeDataset === 'layout' || activeDataset === 'groundtruth') {
        const metadata = layoutRunMetadata ?? null;
        baseGeojson._layout = {
          dataset: activeDataset,
          algorithm: activeAlgorithm,
          pipeline: metadata?.pipeline ?? [activeAlgorithm],
          generated_at: new Date().toISOString(),
          source_layout: metadata,
          item_count: metadata?.itemCount ?? layoutOutputs.length,
        };
        if (metadata?.runtimeMs !== undefined) {
          baseGeojson._layout_runtime_ms = metadata.runtimeMs;
        }
        if (metadata?.seed !== undefined) {
          baseGeojson._layout_seed = metadata.seed;
        }
      }

      const [geojsonResult, mapInfoResult] = await Promise.all([
        saveSessionGeojson({
          sessionId,
          geojson: baseGeojson,
          filename: `${filename}_${DATASET_CONFIG[activeDataset].suffix}`,
          category: activeDataset,
        }),
        mapInfo ? saveSessionMapInfo({ sessionId, mapInfo: convertMapInfo(mapInfo) }) : Promise.resolve({ success: false }),
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
  }, [activeDataset, activeAlgorithm, sessionId, geojson, layoutOutputs, layoutInputs, originPositions, groundtruthPositions, mapInfo, filename, layoutRunMetadata]);

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
          <label className="text-xs text-gray-500 mb-1 block">Layout Algorithm</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleAlgorithmChange('force')}
              className={`flex-1 text-[11px] px-2 py-1 rounded-md border font-semibold transition-all text-center ${
                activeAlgorithm === 'force'
                  ? 'bg-purple-50 border-purple-300 text-purple-700 font-medium'
                  : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
              }`}
            >
              Force
            </button>
            <button
              onClick={() => handleAlgorithmChange('simulatedAnnealing')}
              className={`flex-1 text-[11px] px-2 py-1 rounded-md border font-semibold transition-all text-center ${
                activeAlgorithm === 'simulatedAnnealing'
                  ? 'bg-purple-50 border-purple-300 text-purple-700 font-medium'
                  : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
              }`}
            >
              SA
            </button>
            <button
              onClick={() => handleAlgorithmChange('weightedVoronoiDirect')}
              className={`text-[11px] px-2 py-1 rounded-md border font-semibold transition-all text-center ${
                activeAlgorithm === 'weightedVoronoiDirect'
                  ? 'bg-purple-50 border-purple-300 text-purple-700 font-medium'
                  : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
              }`}
            >
              Voronoi Base
            </button>
            <button
              onClick={() => handleAlgorithmChange('weightedVoronoi')}
              className={`text-[11px] px-2 py-1 rounded-md border font-semibold transition-all text-center ${
                activeAlgorithm === 'weightedVoronoi'
                  ? 'bg-purple-50 border-purple-300 text-purple-700 font-medium'
                  : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
              }`}
            >
              Force + Voronoi
            </button>
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block" htmlFor="layout-seed">Random Seed</label>
          <input
            id="layout-seed"
            type="number"
            min={1}
            max={4294967295}
            step={1}
            value={layoutSeed}
            onChange={(event) => handleSeedChange(event.target.value)}
            className="w-full h-8 px-2 text-[11px] border rounded-md focus:outline-none focus:ring-2 focus:ring-gray-800/50"
          />
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
