import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { VisualizationSpec } from '../core/contracts';

interface VisualizationSpecViewProps {
  spec: VisualizationSpec;
}

export const VisualizationSpecView: React.FC<VisualizationSpecViewProps> = ({ spec }) => {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;

    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current);
    }

    const chart = chartInstanceRef.current;

    let option: echarts.EChartsOption = {};

    if (spec.type === 'bar' || spec.type === 'stacked_bar') {
      const categories = spec.data.map(d => String(d[spec.encoding.x?.field || 'segment'] || ''));
      const seriesData = spec.data.map(d => Number(d[spec.encoding.y?.field || 'current']) || 0);
      const secondaryData = spec.encoding.secondaryY
        ? spec.data.map(d => Number(d[spec.encoding.secondaryY!.field]) || 0)
        : null;

      option = {
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
        },
        grid: {
          top: '15%',
          left: '3%',
          right: secondaryData ? '10%' : '4%',
          bottom: '10%',
          containLabel: true,
        },
        xAxis: {
          type: 'category',
          data: categories,
          axisLine: { lineStyle: { color: '#cbd5e1' } },
          axisLabel: { color: '#475569', fontSize: 11, rotate: categories.length > 5 ? 25 : 0 },
        },
        yAxis: secondaryData
          ? [
              {
                type: 'value',
                name: spec.encoding.y?.title || '',
                axisLine: { lineStyle: { color: '#cbd5e1' } },
                axisLabel: { color: '#64748b' },
                splitLine: { lineStyle: { color: '#f1f5f9' } },
              },
              {
                type: 'value',
                name: spec.encoding.secondaryY?.title || 'Delta',
                axisLine: { lineStyle: { color: '#cbd5e1' } },
                axisLabel: { color: '#64748b' },
                splitLine: { show: false },
              },
            ]
          : {
              type: 'value',
              name: spec.encoding.y?.title || '',
              axisLine: { lineStyle: { color: '#cbd5e1' } },
              axisLabel: { color: '#64748b' },
              splitLine: { lineStyle: { color: '#f1f5f9' } },
            },
        series: secondaryData
          ? [
              {
                name: spec.encoding.y?.title || 'Value',
                type: 'bar',
                data: seriesData,
                itemStyle: { color: '#a50034', borderRadius: [4, 4, 0, 0] },
                barMaxWidth: 35,
              },
              {
                name: spec.encoding.secondaryY?.title || 'Variance',
                type: 'line',
                yAxisIndex: 1,
                data: secondaryData,
                itemStyle: { color: '#1e293b' },
                lineStyle: { width: 2, type: 'dashed' },
              },
            ]
          : [
              {
                name: spec.encoding.y?.title || 'Value',
                type: 'bar',
                data: seriesData,
                itemStyle: { color: '#a50034', borderRadius: [4, 4, 0, 0] },
                barMaxWidth: 35,
              },
            ],
      };
    } else if (spec.type === 'donut') {
      const pieData = spec.data.map(d => ({
        name: String(d.name || d.segment || 'Other'),
        value: Number(d.value || d.current) || 0,
      }));

      option = {
        tooltip: {
          trigger: 'item',
          formatter: '{b}: {c} ({d}%)',
        },
        legend: {
          bottom: '0%',
          left: 'center',
          textStyle: { fontSize: 11, color: '#475569' },
        },
        series: [
          {
            type: 'pie',
            radius: ['45%', '70%'],
            avoidLabelOverlap: false,
            itemStyle: {
              borderRadius: 6,
              borderColor: '#fff',
              borderWidth: 2,
            },
            label: { show: false },
            emphasis: {
              label: {
                show: true,
                fontSize: 12,
                fontWeight: 'bold',
              },
            },
            data: pieData,
            color: ['#a50034', '#1e3a8a', '#047857', '#f59e0b', '#64748b'],
          },
        ],
      };
    }

    chart.setOption(option, true);

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.dispose();
      chartInstanceRef.current = null;
    };
  }, [spec]);

  return (
    <div className="bg-white rounded-2xl border border-neutral-200/90 shadow-sm p-4 sm:p-5 flex flex-col justify-between">
      <div className="mb-2">
        <h4 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-neutral-800">
          {spec.title}
        </h4>
        {spec.subtitle && (
          <p className="text-[10px] text-neutral-500 mt-0.5">
            {spec.subtitle}
          </p>
        )}
      </div>

      <div ref={chartRef} className="h-64 sm:h-72 w-full" />
    </div>
  );
};
