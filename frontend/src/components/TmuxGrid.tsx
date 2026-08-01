"use client";

import React from "react";
import { CyberGridGroup, CyberStackGroup, CyberContainer } from "ccru/components";
import { useTheme } from "next-themes";

// Module-level component: defining this inside TmuxGrid gave it a new identity
// every render, remounting all Plot children on any state change (which broke
// camera animation and made exports capture purged graph divs).
const WrappedView = ({ view, index, theme, renderView }: {
    view: any, index: number, theme: string | undefined,
    renderView: (view: any, index: number) => React.ReactNode,
}) => {
    const isPinned = view.id !== 'active';
    const title = view.label ?? (isPinned ? "Pinned View" : "Active View");

    if (theme === 'terminal') {
        return (
            <div className="h-full w-full relative border border-[#10ff50]/30 bg-black/40 flex flex-col">
                <div className="absolute top-3 left-3 z-10 pointer-events-none text-[10px] font-bold uppercase tracking-widest text-[#10ff50]/50">
                    {title}
                </div>
                <div className="flex-grow w-full relative">
                    {renderView(view, index)}
                </div>
            </div>
        );
    }

    return (
        <div className="h-full w-full bauhaus-panel">
            {renderView(view, index)}
        </div>
    );
};

export function TmuxGrid({ views, renderView }: { views: any[], renderView: (view: any, index: number) => React.ReactNode }) {
   const { theme } = useTheme();

   const pane = (i: number) => <WrappedView view={views[i]} index={i} theme={theme} renderView={renderView} />;

   if (views.length === 0) return null;
   if (views.length === 1) return <div className="w-full h-full p-2">{pane(0)}</div>;

   if (views.length === 2) {
       return (
           <div className="w-full h-full p-2 flex gap-2">
               <div className="w-1/2 h-full">{pane(0)}</div>
               <div className="w-1/2 h-full">{pane(1)}</div>
           </div>
       )
   }

   if (views.length === 3) {
       return (
           <div className="w-full h-full p-2 flex gap-2">
               <div className="w-1/2 h-full">{pane(0)}</div>
               <div className="w-1/2 h-full flex flex-col gap-2">
                   <div className="h-1/2 w-full">{pane(1)}</div>
                   <div className="h-1/2 w-full">{pane(2)}</div>
               </div>
           </div>
       )
   }

   // length >= 4:
   return (
       <div className="w-full h-full p-2 flex gap-2">
           <div className="w-1/2 h-full flex flex-col gap-2">
               <div className="h-1/2 w-full">{pane(0)}</div>
               <div className="h-1/2 w-full">{pane(3)}</div>
           </div>
           <div className="w-1/2 h-full flex flex-col gap-2">
               <div className="h-1/2 w-full">{pane(1)}</div>
               <div className="h-1/2 w-full">{pane(2)}</div>
           </div>
       </div>
   )
}
