'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ImageIcon, MoreVerticalIcon, PaperclipIcon, SendIcon, SparklesIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { API_BASE_URL, buildFileUrl, submitVlmReviewRevision } from '@/lib/api';
import {
  useAgentMap,
  type AgentRunEvent,
  type RevisionScope,
} from '@/lib/agentMapContext';

type SessionSummary = {
  session_id: string;
  created_at?: string;
  status?: string;
};

interface AgentInteractionPanelProps {
  sessions: SessionSummary[];
  currentSession: any;
  onLoadSession: (sessionId: string) => void;
  onRunCompleted?: (sessionId: string) => void;
}

const basename = (value?: string | null) => {
  if (!value) return '';
  return String(value).split(/[\\/]/).filter(Boolean).pop() || String(value);
};

const summarizeSession = (sessionId: string) => {
  const shortId = sessionId.replace(/^\d{8}_\d{6}_/, '');
  return shortId.length > 18 ? `${shortId.slice(0, 18)}...` : shortId;
};

const selectedScopeFromContext = (selection: any, event: AgentRunEvent | null): RevisionScope => {
  if (selection?.kind === 'map_feature') {
    const payload = selection.payload || {};
    const geometryType = payload.geometryType;
    const elementId = String(
      payload.feature?.properties?.feature_id ||
      payload.feature?.properties?.visual_id ||
      payload.routeStyle?.visual_id ||
      selection.label ||
      selection.node_id ||
      'selected_element',
    );
    const elementType = selection.node_id === 'map_line'
      ? 'route'
      : selection.node_id === 'map_point'
        ? 'poi'
        : selection.node_id === 'map_global' || selection.node_id === 'map_leader_line'
          ? 'area'
            : geometryType === 'Point'
              ? 'poi'
              : 'label';
    return { type: 'element', elementId, elementType };
  }
  const nodeId = selection?.node_id || event?.node_id || null;
  if (nodeId && nodeId !== 'input') return { type: 'node', nodeId };
  return { type: 'global' };
};

const scopeLabel = (scope: RevisionScope) => {
  if (scope.type === 'global') return 'Global';
  if (scope.type === 'node') return `Current Node: ${scope.nodeId}`;
  return `Selected Element: ${scope.elementId}`;
};

const inputPayloadFromEvents = (events: AgentRunEvent[]) => {
  const event = events.find((item) => item.type === 'workflow_started' || item.node_id === 'input');
  const payload = event?.payload || {};
  const input = payload.input || payload;
  const prompt = input.user_text || input.message || payload.user_text || payload.message || '';
  const imageName = basename(input.image_filename || input.imageFilename || input.image_path || payload.image_filename || payload.imageFilename || '');
  return {
    prompt,
    imageName,
    imageUrl: imageName ? buildFileUrl(imageName) : '',
  };
};

const AgentInteractionPanel: React.FC<AgentInteractionPanelProps> = ({
  sessions,
  currentSession,
  onLoadSession,
  onRunCompleted,
}) => {
  const {
    mode,
    setSpecfilename,
    setManifest,
    manifest,
    geojson,
    setGeojson,
    visualStructure,
    setVisualStructure,
    agentEvents,
    appendAgentEvent,
    clearAgentEvents,
    activeRunId,
    setActiveRunId,
    setIsAgentRunning,
    selectedAgentEvent,
    selectedAgentSelection,
    conversationMessages,
    setConversationMessages,
    revisionJobs,
    setRevisionJobs,
    versionCards,
    setVersionCards,
    labelLayout,
    setLabelLayout,
    manualEditState,
    captureMapScreenshot,
    recordManualEdit,
  } = useAgentMap();
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [scopeOverride, setScopeOverride] = useState<'global' | 'node' | 'element' | null>(null);
  const [panelNotice, setPanelNotice] = useState('');
  const [showMaterialMenu, setShowMaterialMenu] = useState(false);
  const [showAllVersions, setShowAllVersions] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const inputPayload = inputPayloadFromEvents(agentEvents);
  const effectiveImageUrl = imagePreview || inputPayload.imageUrl;
  const effectiveImageName = basename(selectedImage) || inputPayload.imageName || 'No reference image';
  const autoScope = useMemo(
    () => selectedScopeFromContext(selectedAgentSelection, selectedAgentEvent),
    [selectedAgentEvent, selectedAgentSelection],
  );
  const currentScope = useMemo<RevisionScope>(() => {
    if (scopeOverride === 'global') return { type: 'global' };
    if (scopeOverride === 'node') {
      const nodeScope = selectedScopeFromContext(null, selectedAgentEvent);
      return nodeScope.type === 'node' ? nodeScope : autoScope;
    }
    if (scopeOverride === 'element') {
      const elementScope = selectedScopeFromContext(selectedAgentSelection, null);
      return elementScope.type === 'element' ? elementScope : autoScope;
    }
    return autoScope;
  }, [autoScope, scopeOverride, selectedAgentEvent, selectedAgentSelection]);
  const canSubmit = mode === 'edit' && message.trim().length > 0 && !loading;

  const showPanelNotice = (text: string) => {
    setPanelNotice(text);
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setPanelNotice(''), 2400);
  };

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
  }, []);

  useEffect(() => {
    setScopeOverride(null);
  }, [selectedAgentEvent, selectedAgentSelection]);

  useEffect(() => {
    const handleFocusInput = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string }>).detail;
      if (mode !== 'edit') return;
      textareaRef.current?.focus();
      if (detail?.text) showPanelNotice(detail.text);
    };
    window.addEventListener('agentmap:focus-revision-input', handleFocusInput);
    return () => window.removeEventListener('agentmap:focus-revision-input', handleFocusInput);
  }, [mode]);

  useEffect(() => {
    if (versionCards.length > 0 || sessions.length === 0) return;
    setVersionCards(sessions.slice(0, 5).map((session, index) => ({
      id: session.session_id,
      title: index === 0 ? 'Current version' : `Version ${sessions.length - index}`,
      summary: summarizeSession(session.session_id),
      createdAt: session.created_at || 'Recent',
      status: index === 0 ? 'Current' : 'Completed',
      sessionId: session.session_id,
    })));
  }, [sessions, setVersionCards, versionCards.length]);

  useEffect(() => () => {
    eventSourceRef.current?.close();
  }, []);

  const handleImageSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please select a valid image file.');
      return;
    }
    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const response = await fetch(`${API_BASE_URL}/api/upload-image`, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || 'Image upload failed');
      setSelectedImage(data.filepath);
      setImagePreview(buildFileUrl(data.filepath));
      showPanelNotice('Reference image uploaded.');
    } catch (error: any) {
      alert(error.message || 'Image upload failed.');
    } finally {
      setLoading(false);
    }
  };

  const runInitialGeneration = async (requestText: string) => {
    if (!selectedImage) {
      alert('Please upload a reference image before generating a new map.');
      return;
    }
    clearAgentEvents();
    setActiveRunId(null);
    setIsAgentRunning(true);
    eventSourceRef.current?.close();
    const response = await fetch(`${API_BASE_URL}/api/multimodal/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: requestText, imageFilename: selectedImage }),
    });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || 'Agent run failed');
    const runId = data.run_id;
    setActiveRunId(runId);

    await new Promise<void>((resolve, reject) => {
      const source = new EventSource(`${API_BASE_URL}/api/multimodal/runs/${runId}/events`);
      eventSourceRef.current = source;
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        source.close();
        eventSourceRef.current = null;
        fn();
      };
      const handleEvent = (event: MessageEvent) => {
        const parsed = JSON.parse(event.data);
        appendAgentEvent(parsed);
        const payload = parsed.payload || {};
        if (parsed.node_id === 'visual' && payload.visual_structure) setVisualStructure(payload.visual_structure);
        if (parsed.node_id === 'geojson' && payload.geojson) setGeojson(payload.geojson);
        if ((parsed.node_id === 'style' || parsed.node_id === 'icon_generation') && payload.style_code) setManifest(payload.style_code);
        if (parsed.type === 'workflow_completed') {
          setGeojson(payload.geojson || null);
          setManifest(payload.style_code || null);
          setVisualStructure(payload.visual_structure || null);
          const completedSessionId = payload.session_id || runId;
          setSpecfilename(completedSessionId);
          onRunCompleted?.(completedSessionId);
          finish(resolve);
        }
        if (parsed.type === 'workflow_error') {
          finish(() => reject(new Error(payload.error || 'Agent workflow failed')));
        }
      };
      [
        'workflow_started',
        'node_started',
        'node_completed',
        'node_validation',
        'node_retry',
        'artifact_saved',
        'workflow_completed',
        'workflow_error',
      ].forEach((eventName) => source.addEventListener(eventName, handleEvent));
      source.onerror = () => finish(() => reject(new Error('Agent event stream disconnected')));
    });
  };

  const runVlmRevision = async (requestText: string) => {
    const sessionId = currentSession?.session_id || activeRunId;
    if (!sessionId || !geojson || !manifest) {
      await runInitialGeneration(requestText);
      return;
    }
    const jobId = `revision-${Date.now()}`;
    setRevisionJobs((jobs) => [{
      id: jobId,
      request: requestText,
      scope: currentScope,
      status: 'Analyzing',
      affectedObjects: [],
      currentStep: 'VLM Review & Revision',
      proposedChanges: [],
      timestamp: new Date().toISOString(),
    }, ...jobs]);
    appendAgentEvent({
      type: 'node_started',
      run_id: sessionId,
      session_id: sessionId,
      node_id: 'vlm_review',
      label: 'VLM Review & Revision',
      status: 'running',
      payload: { request: requestText, scope: currentScope },
      timestamp: new Date().toISOString(),
    });
    setRevisionJobs((jobs) => jobs.map((job) => job.id === jobId ? {
      ...job,
      status: 'Revising',
      currentStep: 'Capturing map screenshot and label layout',
    } : job));
    const screenshot = captureMapScreenshot ? await captureMapScreenshot().catch((error) => {
      console.warn('Map screenshot capture failed before VLM revision.', error);
      return '';
    }) : '';
    const inputWarnings = [
      screenshot ? '' : 'Map screenshot is unavailable; VLM revision will run with an empty screenshot placeholder.',
      labelLayout.length > 0 ? '' : 'Label layout metadata is not ready; VLM revision will run with an empty label layout list.',
      geojson ? '' : 'GeoJSON is unavailable.',
      manifest ? '' : 'Style JSON is unavailable.',
    ].filter(Boolean);
    if (inputWarnings.length > 0) {
      console.warn('VLM revision input warnings:', inputWarnings);
    }
    setRevisionJobs((jobs) => jobs.map((job) => job.id === jobId ? {
      ...job,
      status: 'Validating',
      currentStep: 'VLM Review & Revision',
    } : job));
    const result = await submitVlmReviewRevision(sessionId, {
      mode: 'user_request',
      userRequest: requestText,
      scope: currentScope,
      geojson,
      styleJson: manifest,
      mapScreenshot: screenshot,
      labelLayout,
      manualEditState,
      selectedElementId: currentScope.type === 'element' ? currentScope.elementId : undefined,
      selectedNodeId: currentScope.type === 'node' ? currentScope.nodeId : undefined,
      originalUserIntent: inputPayload.prompt,
      reviewHistory: inputWarnings.length > 0 ? [{ warnings: inputWarnings }] as any : [],
    });
    setGeojson(result.geojson);
    setManifest(result.styleJson);
    setLabelLayout(result.labelLayout || labelLayout);
    recordManualEdit(
      currentScope.type === 'element' ? currentScope.elementId : currentScope.type === 'node' ? currentScope.nodeId : 'global',
      ['chat_request'],
      'chat_request',
    );
    setRevisionJobs((jobs) => jobs.map((job) => job.id === jobId ? {
      ...job,
      status: result.passed ? 'Passed' : 'Needs Revision',
      affectedObjects: result.changedObjects,
      proposedChanges: result.changeSummary,
      currentStep: result.nextAction === 'rerun_review' ? 'Review loop requested' : 'Applied',
    } : job));
    appendAgentEvent({
      type: 'node_completed',
      run_id: sessionId,
      session_id: sessionId,
      node_id: 'vlm_review',
      label: 'VLM Review & Revision',
      status: result.passed ? 'passed' : 'needs_revision',
      payload: result,
      timestamp: new Date().toISOString(),
    });
    setVersionCards((cards) => [{
      id: `version-${Date.now()}`,
      title: 'Revision version',
      summary: requestText,
      createdAt: 'Just now',
      sessionId,
      status: result.passed ? 'Completed' : 'In Progress',
    }, ...cards]);
    setConversationMessages((messages) => [...messages, {
      id: `agent-${Date.now()}`,
      role: 'agent',
      text: result.changeSummary[0] || 'I reviewed the map and preserved the current layout.',
      timestamp: new Date().toISOString(),
      scope: currentScope,
    }]);
  };

  const handleAttachContext = () => {
    if (mode !== 'edit') {
      showPanelNotice('Switch to Edit mode to attach context.');
      return;
    }
    fileInputRef.current?.click();
  };

  const clearLocalReference = () => {
    setSelectedImage(null);
    setImagePreview(null);
    setShowMaterialMenu(false);
    showPanelNotice('Local reference selection cleared.');
  };

  const scopeOptions = [
    { id: 'global', label: 'Global', enabled: true },
    { id: 'node', label: 'Current Node', enabled: selectedScopeFromContext(null, selectedAgentEvent).type === 'node' },
    { id: 'element', label: 'Selected Element', enabled: selectedScopeFromContext(selectedAgentSelection, null).type === 'element' },
  ] as const;

  const handleSubmit = async () => {
    const requestText = message.trim();
    if (!requestText || mode !== 'edit') return;
    setLoading(true);
    setMessage('');
    setConversationMessages((messages) => [...messages, {
      id: `user-${Date.now()}`,
      role: 'user',
      text: requestText,
      timestamp: new Date().toISOString(),
      scope: currentScope,
    }]);
    try {
      await runVlmRevision(requestText);
    } catch (error: any) {
      alert(error.message || 'Request failed.');
      setRevisionJobs((jobs) => jobs.map((job, index) => index === 0 ? { ...job, status: 'Failed', currentStep: error.message || 'Failed' } : job));
    } finally {
      setLoading(false);
      setIsAgentRunning(false);
    }
  };

  return (
    <aside className="flex h-full w-[320px] flex-shrink-0 flex-col border-r border-gray-200 bg-[#f8fafc]">
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <section className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <div className="relative mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#131722]">Reference & Materials</h2>
            <button
              type="button"
              onClick={() => setShowMaterialMenu((open) => !open)}
              className="rounded-md p-1 text-gray-500 hover:bg-gray-100"
              title="More"
            >
              <MoreVerticalIcon className="h-4 w-4" />
            </button>
            {showMaterialMenu && (
              <div className="absolute right-0 top-7 z-20 w-44 rounded-lg border border-gray-200 bg-white p-1 text-xs shadow-lg">
                <button
                  type="button"
                  disabled={mode !== 'edit' || loading}
                  onClick={() => {
                    setShowMaterialMenu(false);
                    fileInputRef.current?.click();
                  }}
                  className="block w-full rounded px-2 py-1.5 text-left text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Upload Reference
                </button>
                <button
                  type="button"
                  onClick={clearLocalReference}
                  className="block w-full rounded px-2 py-1.5 text-left text-gray-700 hover:bg-gray-50"
                >
                  Clear Local Selection
                </button>
              </div>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || mode !== 'edit'}
            className="group w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50 text-left disabled:opacity-60"
          >
            {effectiveImageUrl ? (
              <img src={effectiveImageUrl} alt="Reference material" className="h-24 w-full object-cover" />
            ) : (
              <div className="grid h-24 place-items-center text-gray-400">
                <ImageIcon className="h-6 w-6" />
              </div>
            )}
            <div className="flex items-center justify-between gap-2 border-t border-gray-200 bg-white px-3 py-2">
              <div>
                <div className="truncate text-xs font-medium text-gray-800">{effectiveImageName}</div>
                <div className="text-[10px] text-gray-500">{effectiveImageUrl ? 'Reference image' : 'Upload reference image'}</div>
              </div>
              {selectedImage && (
                <XIcon
                  className="h-4 w-4 text-gray-400"
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedImage(null);
                    setImagePreview(null);
                  }}
                />
              )}
            </div>
          </button>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#131722]">Conversation</h2>
            <span className="text-[10px] text-gray-500">Scope</span>
          </div>
          <div className="mb-3 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {scopeOptions.map((option) => {
                const active = (scopeOverride || autoScope.type) === option.id || currentScope.type === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={!option.enabled || mode !== 'edit'}
                    onClick={() => setScopeOverride(option.id)}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      active
                        ? 'border-blue-200 bg-blue-50 text-blue-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] font-medium text-blue-700">
              {scopeLabel(currentScope)}
            </div>
          </div>
          <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
            {conversationMessages.length === 0 && (
              <div className="rounded-lg bg-gray-50 p-3 text-xs leading-5 text-gray-500">
                Create or revise a travel map with natural language. Select a map element or process node to target the next request.
              </div>
            )}
            {conversationMessages.map((item) => (
              <div key={item.id} className={`rounded-lg px-3 py-2 text-xs leading-5 ${item.role === 'user' ? 'bg-[#131722] text-white' : 'bg-gray-100 text-gray-700'}`}>
                <div>{item.text}</div>
                <div className={`mt-1 text-[9px] ${item.role === 'user' ? 'text-white/60' : 'text-gray-400'}`}>{scopeLabel(item.scope || { type: 'global' })}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-lg border border-gray-200 bg-white p-2">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              disabled={mode !== 'edit' || loading}
              placeholder={mode === 'edit' ? 'Describe your revision...' : 'Switch to Edit mode to submit changes.'}
              className="h-20 w-full resize-none bg-transparent text-xs leading-5 outline-none placeholder:text-gray-400 disabled:cursor-not-allowed"
            />
            <div className="flex items-center justify-between border-t border-gray-100 pt-2">
              <button
                type="button"
                onClick={handleAttachContext}
                disabled={mode !== 'edit' || loading}
                className="rounded-md p-1 text-gray-400 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                title="Attach context"
              >
                <PaperclipIcon className="h-4 w-4" />
              </button>
              <Button size="sm" disabled={!canSubmit} onClick={handleSubmit} className="h-8 bg-[#131722] px-3 text-xs text-white hover:bg-black">
                {loading ? <SparklesIcon className="h-4 w-4 animate-pulse" /> : <SendIcon className="h-4 w-4" />}
                Submit
              </Button>
            </div>
          </div>
        </section>

        {revisionJobs[0] && (
          <section className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <h2 className="text-sm font-semibold text-[#131722]">
              {['Passed', 'Needs Revision', 'Failed'].includes(revisionJobs[0].status) ? 'Revision Status' : 'Revision in Progress'}
            </h2>
            <div className="mt-3 space-y-2 text-xs text-gray-600">
              <div><span className="font-semibold text-gray-800">Request:</span> {revisionJobs[0].request}</div>
              <div><span className="font-semibold text-gray-800">Scope:</span> {scopeLabel(revisionJobs[0].scope)}</div>
              <div><span className="font-semibold text-gray-800">Status:</span> {revisionJobs[0].status}</div>
              <div><span className="font-semibold text-gray-800">Current Step:</span> {revisionJobs[0].currentStep}</div>
              <div><span className="font-semibold text-gray-800">Affected Objects:</span> {revisionJobs[0].affectedObjects.join(', ') || 'No structural changes'}</div>
              <div><span className="font-semibold text-gray-800">Proposed Changes:</span> {revisionJobs[0].proposedChanges.join('; ') || 'No proposed changes yet'}</div>
              <div><span className="font-semibold text-gray-800">Timestamp:</span> {new Date(revisionJobs[0].timestamp).toLocaleString()}</div>
            </div>
          </section>
        )}

        <section className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#131722]">Version History</h2>
            <button
              type="button"
              onClick={() => {
                setShowAllVersions((value) => !value);
                showPanelNotice(showAllVersions ? 'Showing recent versions.' : 'Showing all available versions.');
              }}
              className="text-xs font-medium text-blue-600"
            >
              {showAllVersions ? 'Show Recent' : 'View All'}
            </button>
          </div>
          {panelNotice && (
            <div className="mb-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] font-medium text-blue-700">
              {panelNotice}
            </div>
          )}
          <div className="space-y-2">
            {(versionCards.length ? versionCards : sessions.slice(0, 4).map((session, index) => ({
              id: session.session_id,
              title: index === 0 ? 'Current version' : `Version ${index + 1}`,
              summary: summarizeSession(session.session_id),
              createdAt: 'Recent',
              sessionId: session.session_id,
              status: index === 0 ? 'Current' : 'Completed',
            }))).slice(0, showAllVersions ? undefined : 5).map((item: any) => {
              const isLocalRevision = String(item.id || '').startsWith('version-');
              const targetSessionId = isLocalRevision ? null : item.sessionId || item.id;
              return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (targetSessionId) {
                    onLoadSession(targetSessionId);
                    return;
                  }
                  showPanelNotice('This revision is already active in the workspace.');
                }}
                className="flex w-full gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left transition hover:border-gray-300 hover:bg-gray-50"
              >
                <div className="h-12 w-16 flex-none rounded bg-gray-100" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-gray-800">{item.title}</div>
                  <div className="truncate text-[10px] text-gray-500">{item.summary}</div>
                  <div className="mt-1 text-[10px] text-gray-400">{item.status} · {item.createdAt}</div>
                </div>
              </button>
            );
            })}
          </div>
        </section>
      </div>
    </aside>
  );
};

export default AgentInteractionPanel;
