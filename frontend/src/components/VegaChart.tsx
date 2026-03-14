import React from 'react';
import { VegaEmbed } from 'react-vega';
import type { ChartSpec } from '@/store/visualizationStore';

interface VegaChartProps {
  data: any[];
  spec: ChartSpec;
}

export const VegaChart: React.FC<VegaChartProps> = ({ data, spec }) => {
  const vegaSpec: any = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    description: spec.description,
    title: spec.title,
    width: "container",
    height: "container",
    mark: { type: spec.chart_type, tooltip: true },
    encoding: {
      x: { field: spec.x_axis, type: 'nominal', axis: { labelAngle: -45 } },
      y: { field: spec.y_axis, type: 'quantitative' },
    },
    data: { values: data }
  };

  if (spec.color) {
    vegaSpec.encoding.color = { field: spec.color, type: 'nominal' };
  }

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
