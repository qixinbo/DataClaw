import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VegaEmbed } from 'react-vega';
import type { ChartSpec } from '@/store/visualizationStore';

interface VegaChartProps {
  data: any[];
  spec: ChartSpec;
}

export const VegaChart: React.FC<VegaChartProps> = ({ data, spec }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const nextWidth = Math.max(0, Math.floor(entry.contentRect.width));
      const nextHeight = Math.max(0, Math.floor(entry.contentRect.height));
      setSize((prev) => (
        prev.width === nextWidth && prev.height === nextHeight
          ? prev
          : { width: nextWidth, height: nextHeight }
      ));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const vegaSpec: any = useMemo(() => {
    // Deep clone spec to avoid mutating React state/props
    const baseSpec = JSON.parse(JSON.stringify(spec));
    
    // Ensure tooltip is enabled in mark if not already specified
    if (typeof baseSpec.mark === 'string') {
      baseSpec.mark = { type: baseSpec.mark, tooltip: true };
    } else if (typeof baseSpec.mark === 'object' && baseSpec.mark !== null) {
      baseSpec.mark.tooltip = true;
    }

    // Add highlight effect: hover over an element makes others transparent
    // 1. Define hover param
    if (!baseSpec.params) {
      baseSpec.params = [];
    }
    const hasHighlight = baseSpec.params.some((p: any) => p.name === "highlight");
    if (!hasHighlight) {
      baseSpec.params.push({
        name: "highlight",
        select: { type: "point", on: "mouseover", clear: "mouseout" }
      });
    }

    // 2. Add conditional opacity to encoding
    if (!baseSpec.encoding) {
      baseSpec.encoding = {};
    }
    
    // Only add opacity highlight if not explicitly set
    if (!baseSpec.encoding.opacity) {
      baseSpec.encoding.opacity = {
        condition: { param: "highlight", value: 1 },
        value: 0.3
      };
    }

    // Also add cursor: pointer for marks
    if (typeof baseSpec.mark === 'object' && baseSpec.mark !== null) {
      baseSpec.mark.cursor = "pointer";
    }

    return {
      $schema: typeof spec.$schema === 'string' ? spec.$schema : 'https://vega.github.io/schema/vega-lite/v5.json',
      ...baseSpec,
      width: size.width > 0 ? size.width : "container",
      height: size.height > 0 ? size.height : "container",
      data: { values: data },
      autosize: { type: "fit", contains: "padding", resize: true },
    };
  }, [data, size.height, size.width, spec]);

  const handleError = (error: any) => {
    console.error("VegaEmbed rendering error:", error, "Spec:", vegaSpec);
  };

  return (
    <div className="w-full h-full overflow-hidden" ref={containerRef}>
      <VegaEmbed 
        spec={vegaSpec} 
        options={{ actions: false }} 
        style={{width: '100%', height: '100%'}} 
        onError={handleError}
      />
    </div>
  );
};
