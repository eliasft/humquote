// ECharts wrappers styled from the design tokens: thin lines, hairline grids,
// 2px surface gaps between stacked segments, crosshair tooltips.

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart as ELineChart } from 'echarts/charts';
import { GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import { useResolvedTheme } from '@/lib/theme';
import { money, shortDate } from '@/lib/format';

echarts.use([BarChart, ELineChart, GridComponent, TooltipComponent, MarkLineComponent, SVGRenderer]);

export const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const seriesColor = (i: number) => token(`--series-${i + 1}`);

function baseOption() {
  const text = token('--chart-text');
  return {
    textStyle: { fontFamily: '"Inter Variable", system-ui, sans-serif', color: text, fontSize: 12 },
    animationDuration: 300,
    animationDurationUpdate: 250,
    tooltip: {
      backgroundColor: token('--card'),
      borderColor: token('--border-strong'),
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: token('--foreground'), fontSize: 13, fontFamily: '"Inter Variable", system-ui, sans-serif' },
      extraCssText: 'border-radius:8px;box-shadow:0 4px 16px -4px rgba(0,0,0,.15);',
    },
  };
}

function axisStyle() {
  return {
    axisLine: { lineStyle: { color: token('--chart-axis') } },
    axisTick: { show: false },
    axisLabel: { color: token('--chart-text'), fontSize: 12 },
    splitLine: { lineStyle: { color: token('--chart-grid'), width: 1 } },
  };
}

export function EChart({ option, height, ariaLabel }: { option: () => EChartsCoreOption; height: number; ariaLabel: string }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const theme = useResolvedTheme();

  useEffect(() => {
    if (!el.current) return;
    chart.current = echarts.init(el.current, undefined, { renderer: 'svg' });
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(el.current);
    return () => { ro.disconnect(); chart.current?.dispose(); chart.current = null; };
  }, []);

  useEffect(() => {
    chart.current?.setOption({ ...baseOption(), ...option() }, { notMerge: true });
  }, [option, theme]);

  return <div ref={el} role="img" aria-label={ariaLabel} style={{ height, width: '100%' }} />;
}

// ── Legend (HTML, so it stays readable and wraps) ─────────────────────────────

export function Legend({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <i className={i.line ? 'h-[3px] w-4 rounded-full' : 'size-2.5 rounded-[3px]'} style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

// ── Line chart over time ──────────────────────────────────────────────────────

export interface LineSeries {
  name: string;
  color: string;
  points: [string, number][];
  width?: number;
  area?: boolean;
  z?: number;
  muted?: boolean;
}

export function timeLineOption(series: LineSeries[], { yFormat, tooltipValue, baseline }: {
  yFormat: (v: number) => string; tooltipValue: (v: number) => string; baseline?: { value: number; label: string };
}) {
  return () => ({
    grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
    tooltip: {
      ...baseOption().tooltip,
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: token('--chart-axis'), width: 1, type: 'solid' } },
      formatter: (params: { seriesName: string; value: [string, number]; color: string }[]) => {
        const visible = params.filter((p) => !series.find((s) => s.name === p.seriesName)?.muted);
        if (!visible.length) return '';
        const head = `<div style="font-weight:600;margin-bottom:4px">${shortDate(visible[0].value[0])}</div>`;
        return head + visible.map((p) =>
          `<div style="display:flex;align-items:center;gap:8px;justify-content:space-between;min-width:150px">
             <span style="display:inline-flex;align-items:center;gap:6px"><i style="width:10px;height:3px;border-radius:2px;background:${p.color}"></i>${p.seriesName}</span>
             <b style="font-variant-numeric:tabular-nums;font-weight:600">${tooltipValue(p.value[1])}</b></div>`).join('');
      },
    },
    xAxis: { type: 'time', ...axisStyle(), splitLine: { show: false }, axisLabel: { ...axisStyle().axisLabel, hideOverlap: true } },
    yAxis: { type: 'value', scale: true, ...axisStyle(), axisLine: { show: false }, axisLabel: { ...axisStyle().axisLabel, formatter: yFormat } },
    series: series.map((s) => ({
      type: 'line',
      name: s.name,
      data: s.points,
      showSymbol: false,
      symbolSize: 8,
      z: s.z ?? 2,
      lineStyle: { color: s.color, width: s.width ?? 2, cap: 'round', join: 'round' },
      itemStyle: { color: s.color, borderColor: token('--card'), borderWidth: 2 },
      emphasis: { disabled: true },
      areaStyle: s.area ? { color: s.color, opacity: 0.08 } : undefined,
      markLine: baseline && s === series[series.length - 1] ? {
        silent: true,
        symbol: 'none',
        lineStyle: { color: token('--chart-axis'), type: 'solid', width: 1 },
        label: { formatter: baseline.label, color: token('--chart-text'), position: 'insideEndTop', fontSize: 11 },
        data: [{ yAxis: baseline.value }],
      } : undefined,
    })),
  });
}

// ── Stacked horizontal bars (price breakdown) ─────────────────────────────────

export function breakdownOption(categories: string[], parts: { name: string; color: string; values: number[] }[], totals: number[]) {
  return () => {
    const surface = token('--card');
    return {
      grid: { left: 8, right: 72, top: 4, bottom: 4, containLabel: true },
      tooltip: {
        ...baseOption().tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: token('--accent-soft') } },
        formatter: (params: { seriesName: string; value: number; color: string; dataIndex: number; name: string }[]) =>
          `<div style="font-weight:600;margin-bottom:4px">${params[0].name}</div>` +
          params.map((p) => `<div style="display:flex;justify-content:space-between;gap:16px"><span style="display:inline-flex;align-items:center;gap:6px"><i style="width:10px;height:10px;border-radius:3px;background:${p.color}"></i>${p.seriesName}</span><b style="font-variant-numeric:tabular-nums;font-weight:600">${money(p.value, 4)}</b></div>`).join('') +
          `<div style="display:flex;justify-content:space-between;gap:16px;margin-top:4px;padding-top:4px;border-top:1px solid ${token('--border')}"><span>Total</span><b style="font-variant-numeric:tabular-nums">${money(totals[params[0].dataIndex], 4)}/kWh</b></div>`,
      },
      xAxis: { type: 'value', ...axisStyle(), axisLabel: { ...axisStyle().axisLabel, formatter: (v: number) => `$${v.toFixed(2)}` } },
      yAxis: { type: 'category', data: categories, inverse: true, ...axisStyle(), axisLine: { show: false }, splitLine: { show: false } },
      series: parts.map((p, i) => ({
        type: 'bar',
        name: p.name,
        stack: 'price',
        data: p.values,
        barMaxWidth: 22,
        itemStyle: {
          color: p.color,
          borderColor: surface,
          borderWidth: 1,
          borderRadius: i === parts.length - 1 ? [0, 4, 4, 0] : 0,
        },
        emphasis: { disabled: true },
        label: i === parts.length - 1 ? {
          show: true,
          position: 'right',
          distance: 8,
          color: token('--foreground'),
          fontSize: 12,
          fontWeight: 600,
          formatter: (d: { dataIndex: number }) => money(totals[d.dataIndex], 4),
        } : undefined,
      })),
    };
  };
}

// ── Tornado (sensitivity) ─────────────────────────────────────────────────────

export function tornadoOption(labels: string[], lowDelta: number[], highDelta: number[], pctLabel: string) {
  return () => {
    const lowColor = token('--diverging-low');
    const highColor = token('--diverging-high');
    const fmt = (v: number) => `${v >= 0 ? '+' : '−'}$${Math.abs(v).toFixed(4)}`;
    // Label each bar at its outer end, and only the larger effects (the table has every value).
    const largest = Math.max(...lowDelta.map(Math.abs), ...highDelta.map(Math.abs));
    const bar = (name: string, data: number[], color: string) => ({
      type: 'bar',
      name,
      data: data.map((v) => ({ value: v, label: { position: v < 0 ? 'left' : 'right' } })),
      barMaxWidth: 16,
      barGap: '-100%',
      itemStyle: { color, borderRadius: 3 },
      emphasis: { disabled: true },
      label: {
        show: true,
        fontSize: 11,
        color: token('--chart-text'),
        formatter: (d: { value: number }) => (Math.abs(d.value) < largest * 0.25 ? '' : fmt(d.value)),
      },
    });
    return {
      grid: { left: 8, right: 64, top: 4, bottom: 4, containLabel: true },
      tooltip: {
        ...baseOption().tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: token('--accent-soft') } },
        formatter: (params: { name: string; seriesName: string; value: number; color: string }[]) =>
          `<div style="font-weight:600;margin-bottom:4px">${params[0].name}</div>` +
          params.map((p) => `<div style="display:flex;justify-content:space-between;gap:16px"><span style="display:inline-flex;align-items:center;gap:6px"><i style="width:10px;height:10px;border-radius:3px;background:${p.color}"></i>${p.seriesName}</span><b style="font-variant-numeric:tabular-nums">${fmt(p.value)}/kWh</b></div>`).join(''),
      },
      xAxis: {
        type: 'value', ...axisStyle(),
        // Symmetric around zero, with room for the end labels on both sides.
        min: -largest * 1.45,
        max: largest * 1.45,
        axisLabel: { ...axisStyle().axisLabel, showMinLabel: false, showMaxLabel: false, formatter: (v: number) => (v === 0 ? '$0' : fmt(v).replace(/0+$/, '').replace(/\.$/, '')) },
      },
      yAxis: { type: 'category', data: labels, inverse: true, ...axisStyle(), axisLine: { lineStyle: { color: token('--chart-axis') } }, splitLine: { show: false } },
      series: [bar(`Input −${pctLabel}`, lowDelta, lowColor), bar(`Input +${pctLabel}`, highDelta, highColor)],
    };
  };
}
