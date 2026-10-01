import React, { useState } from 'react';
import type { BusinessGraph, GraphNode } from '../core/contracts';
import { 
  GitBranch, 
  TrendingUp, 
  TrendingDown, 
  Sparkles, 
  Target, 
  ArrowRight,
  ShieldCheck,
  CheckCircle2
} from 'lucide-react';

interface BusinessGraphViewProps {
  graph: BusinessGraph;
}

export const BusinessGraphView: React.FC<BusinessGraphViewProps> = ({ graph }) => {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const rootNode = graph.nodes.find(n => n.type === 'metric') || graph.nodes[0];
  const driverNodes = graph.nodes.filter(n => n.type === 'driver');
  const insightNodes = graph.nodes.filter(n => n.type === 'insight');
  const actionNodes = graph.nodes.filter(n => n.type === 'action');

  return (
    <div className="bg-white rounded-2xl border border-neutral-200/90 shadow-sm p-5 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-100 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-6 w-6 rounded-lg bg-neutral-900 text-white flex items-center justify-center">
              <GitBranch className="h-3.5 w-3.5 text-amber-400" />
            </span>
            <h3 className="text-base sm:text-lg font-bold text-neutral-900 font-sans tracking-tight">
              Business Knowledge Graph · Cause & Effect
            </h3>
          </div>
          <p className="text-xs text-neutral-500 mt-1">
            Governed semantic network showing root metrics, variance drivers, verified insights, and strategic actions.
          </p>
        </div>

        <div className="flex items-center gap-2 text-[11px] font-semibold text-neutral-500 bg-neutral-50 px-3 py-1.5 rounded-xl border border-neutral-200">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#a50034]" /> Metric
          </span>
          <span className="flex items-center gap-1.5 ml-2">
            <span className="h-2 w-2 rounded-full bg-blue-600" /> Driver
          </span>
          <span className="flex items-center gap-1.5 ml-2">
            <span className="h-2 w-2 rounded-full bg-purple-600" /> Insight
          </span>
          <span className="flex items-center gap-1.5 ml-2">
            <span className="h-2 w-2 rounded-full bg-emerald-600" /> Action
          </span>
        </div>
      </div>

      {/* Interactive Visual Graph Canvas */}
      <div className="relative bg-[#f8f9fa] rounded-xl border border-neutral-200/70 p-6 min-h-[380px] overflow-x-auto">
        <div className="min-w-[650px] flex flex-col items-center gap-8">
          
          {/* Level 0: Root Metric Node */}
          {rootNode && (
            <div 
              onClick={() => setSelectedNode(rootNode)}
              className={`p-4 rounded-xl bg-white border-2 transition-all cursor-pointer shadow-sm text-center w-72 ${
                selectedNode?.id === rootNode.id 
                  ? 'border-[#a50034] ring-4 ring-[#a50034]/10' 
                  : 'border-neutral-300 hover:border-neutral-400'
              }`}
            >
              <div className="flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                <Target className="h-3 w-3 text-[#a50034]" />
                <span>ROOT BUSINESS METRIC</span>
              </div>
              <div className="text-lg font-black text-neutral-900 mt-1">
                {rootNode.label}
              </div>
              <div className="flex items-center justify-center gap-2 mt-1">
                <span className="text-base font-bold text-neutral-800">
                  {rootNode.data.value}
                </span>
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                  rootNode.data.status === 'positive' 
                    ? 'bg-emerald-50 text-emerald-700' 
                    : 'bg-rose-50 text-rose-700'
                }`}>
                  {rootNode.data.delta}
                </span>
              </div>
            </div>
          )}

          {/* Connection Arrows from Drivers to Root */}
          <div className="flex items-center justify-center text-neutral-400 text-xs font-mono">
            <span className="px-2 py-0.5 rounded bg-neutral-200/70 text-[10px] font-bold text-neutral-600">
              ▲ CONTRIBUTES_TO
            </span>
          </div>

          {/* Level 1: Driver Nodes */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full">
            {driverNodes.map((node) => (
              <div
                key={node.id}
                onClick={() => setSelectedNode(node)}
                className={`p-3.5 rounded-xl bg-white border transition-all cursor-pointer shadow-xs ${
                  selectedNode?.id === node.id 
                    ? 'border-blue-600 ring-4 ring-blue-500/10' 
                    : 'border-neutral-200 hover:border-neutral-300'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] font-bold text-neutral-400">
                  <span>DRIVER SEGMENT</span>
                  {node.data.status === 'positive' ? (
                    <TrendingUp className="h-3 w-3 text-emerald-600" />
                  ) : (
                    <TrendingDown className="h-3 w-3 text-rose-600" />
                  )}
                </div>
                <div className="text-sm font-bold text-neutral-900 mt-1 truncate" title={node.label}>
                  {node.label}
                </div>
                <div className="flex items-baseline justify-between mt-2 pt-2 border-t border-neutral-100">
                  <span className="text-xs font-bold text-neutral-700">
                    {node.data.value}
                  </span>
                  <span className={`text-[11px] font-bold ${
                    node.data.status === 'positive' ? 'text-emerald-700' : 'text-rose-700'
                  }`}>
                    {node.data.delta}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Connection from Insights to Actions */}
          {(insightNodes.length > 0 || actionNodes.length > 0) && (
            <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-dashed border-neutral-200">
              {insightNodes.map((node, idx) => (
                <div 
                  key={node.id}
                  onClick={() => setSelectedNode(node)}
                  className={`p-4 rounded-xl bg-purple-50/40 border transition-all cursor-pointer ${
                    selectedNode?.id === node.id 
                      ? 'border-purple-600 ring-4 ring-purple-500/10' 
                      : 'border-purple-200/80 hover:border-purple-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-purple-700">
                    <Sparkles className="h-3 w-3" />
                    <span>CAUSAL INSIGHT</span>
                  </div>
                  <div className="text-xs font-bold text-neutral-900 mt-1 leading-snug">
                    {node.label}
                  </div>
                  {node.data.details && (
                    <p className="text-[11px] text-neutral-600 mt-1.5 line-clamp-2">
                      {node.data.details}
                    </p>
                  )}
                </div>
              ))}

              {actionNodes.map((node) => (
                <div 
                  key={node.id}
                  onClick={() => setSelectedNode(node)}
                  className={`p-4 rounded-xl bg-emerald-50/40 border transition-all cursor-pointer ${
                    selectedNode?.id === node.id 
                      ? 'border-emerald-600 ring-4 ring-emerald-500/10' 
                      : 'border-emerald-200/80 hover:border-emerald-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                    <CheckCircle2 className="h-3 w-3" />
                    <span>PRESCRIBED ACTION</span>
                  </div>
                  <div className="text-xs font-bold text-neutral-900 mt-1 leading-snug">
                    {node.label}
                  </div>
                  {node.data.details && (
                    <p className="text-[11px] text-neutral-600 mt-1.5 line-clamp-2">
                      {node.data.details}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Selected Node Details Drawer */}
      {selectedNode && (
        <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-200 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                {selectedNode.data.category || selectedNode.type}
              </span>
              <span className="text-xs font-bold text-neutral-800">
                · {selectedNode.label}
              </span>
            </div>
            <p className="text-xs text-neutral-600 mt-1">
              {selectedNode.data.details || `Value: ${selectedNode.data.value} | Delta: ${selectedNode.data.delta}`}
            </p>
          </div>
          <button 
            type="button" 
            onClick={() => setSelectedNode(null)}
            className="text-xs text-neutral-400 hover:text-neutral-700 font-bold shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
};
