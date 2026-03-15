import React from 'react';
import { VegaEmbed } from 'react-vega';
import type { ChartSpec } from '@/store/visualizationStore';

interface VegaChartProps {
  data: any[];
  spec: ChartSpec;
}

export const VegaChart: React.FC<VegaChartProps> = ({ data, spec }) => {
  const vegaSpec: any = {
    $schema: typeof spec.$schema === 'string' ? spec.$schema : 'https://vega.github.io/schema/vega-lite/v5.json',
    ...spec,
    width: "container",
    height: "container",
    data: { values: data },
    autosize: { type: "fit", contains: "padding" },
  };

  return (
    <div className="w-full h-full">
      <VegaEmbed 
        spec={vegaSpec} 
        options={{ actions: false }} 
        style={{width: '100%', height: '100%'}} 
      />
    </div>
  );
};
