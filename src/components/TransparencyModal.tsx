import React from 'react';
import type { Evidence } from '../core/contracts';
import { 
  ShieldCheck, 
  CheckCircle2, 
  Database, 
  FileCode2, 
  Calculator, 
  X, 
  AlertTriangle 
} from 'lucide-react';

interface TransparencyModalProps {
  evidence: Evidence | null;
  onClose: () => void;
}

export const TransparencyModal: React.FC<TransparencyModalProps> = ({ evidence, onClose }) => {
  if (!evidence) return null;

  const vr = evidence.verificationResult;

  return (
    <div className="fixed inset-0 z-50 bg-neutral-900/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden shadow-2xl flex flex-col border border-neutral-200">
        
        {/* Modal Header */}
        <div className="p-5 border-b border-neutral-100 flex items-center justify-between bg-neutral-50/80">
          <div className="flex items-center gap-2.5">
            <span className="h-8 w-8 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-bold text-neutral-900 font-sans tracking-tight">
                How Was This Calculated?
              </h3>
              <p className="text-xs text-neutral-500">
                Mathematical Verification Ledger & Traceability Audit Trail
              </p>
            </div>
          </div>

          <button 
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200/60 transition cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs text-neutral-700">
          
          {/* Claim Banner */}
          <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-100 text-blue-900">
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700 block mb-1">
              VERIFIED BUSINESS CLAIM
            </span>
            <p className="text-sm font-semibold leading-snug">
              "{evidence.claim}"
            </p>
          </div>

          {/* Traceability Chain */}
          <div className="space-y-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 block">
              EXECUTION & VERIFICATION CHAIN
            </span>

            {/* Step 1: Dataset & Version */}
            <div className="flex items-start gap-3 p-3 rounded-xl bg-neutral-50 border border-neutral-200/80">
              <Database className="h-4 w-4 text-neutral-600 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <span className="font-bold text-neutral-900">1. Dataset Source & Version</span>
                <p className="text-[11px] text-neutral-500 mt-0.5">
                  Bound to immutable DatasetVersion: <code className="bg-neutral-200/70 px-1 py-0.5 rounded font-mono text-[10px]">{evidence.datasetVersionId}</code>
                </p>
              </div>
            </div>

            {/* Step 2: Query Execution */}
            <div className="flex items-start gap-3 p-3 rounded-xl bg-neutral-50 border border-neutral-200/80">
              <FileCode2 className="h-4 w-4 text-neutral-600 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <span className="font-bold text-neutral-900">2. Governed Query Execution</span>
                <p className="text-[11px] text-neutral-500 mt-0.5">
                  QueryRun ID: <code className="bg-neutral-200/70 px-1 py-0.5 rounded font-mono text-[10px]">{evidence.queryRunId}</code>
                </p>
              </div>
            </div>

            {/* Step 3: Calculation Formula */}
            <div className="flex items-start gap-3 p-3 rounded-xl bg-neutral-50 border border-neutral-200/80">
              <Calculator className="h-4 w-4 text-neutral-600 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <span className="font-bold text-neutral-900">3. Mathematical Formula</span>
                <p className="text-[11px] text-neutral-700 font-mono mt-0.5 bg-white p-2 rounded border border-neutral-200">
                  {evidence.calculationFormula}
                </p>
              </div>
            </div>

            {/* Step 4: Verification Checks */}
            <div className="p-3 rounded-xl bg-neutral-50 border border-neutral-200/80 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-neutral-900">4. Independent Verification Checks</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  vr.overallPassed 
                    ? 'bg-emerald-100 text-emerald-800' 
                    : 'bg-amber-100 text-amber-800'
                }`}>
                  {vr.overallPassed ? 'ALL CHECKS PASSED (100% CONFIDENCE)' : 'UNCERTAINTY DETECTED'}
                </span>
              </div>

              <div className="space-y-1.5 pt-1">
                {vr.checks.map((chk) => (
                  <div key={chk.id} className="p-2.5 rounded-lg bg-white border border-neutral-200 flex items-start gap-2">
                    {chk.passed ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-semibold text-neutral-800">
                        {chk.claimText}
                      </div>
                      <div className="text-[10px] text-neutral-500 mt-0.5 font-mono">
                        {chk.details}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-neutral-100 bg-neutral-50 flex items-center justify-between">
          <span className="text-[10px] text-neutral-400 font-mono">
            Audit Ledger Signature: {evidence.id}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-neutral-900 text-white text-xs font-semibold hover:bg-neutral-800 transition cursor-pointer"
          >
            Close Audit
          </button>
        </div>
      </div>
    </div>
  );
};
