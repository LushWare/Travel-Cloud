import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { chartTooltipStyle, CHART_PALETTE } from '../chartTheme';

export const DEFAULT_PIE_COLORS = CHART_PALETTE;

interface PieChartComponentProps {
  data: Record<string, any>[];
  dataKey?: string;
  nameKey?: string;
  height?: number;
  colors?: string[];
  legendProps?: Record<string, unknown> | false;
  pieProps?: Record<string, unknown>;
  tooltipFormatter?: (value: any) => string;
  labelFormatter?: (label: any) => string;
  totalFormatter?: (total: number) => string;
}

const PieChartComponent = ({
  data,
  dataKey = 'value',
  nameKey = 'name',
  height = 300,
  colors = DEFAULT_PIE_COLORS,
  legendProps = {},
  pieProps = {},
  tooltipFormatter,
  totalFormatter = (value) => `${value}`,
}: PieChartComponentProps) => {
  const total = data.reduce((sum, item) => sum + (item[dataKey] || 0), 0);

  const shouldRenderLegend = legendProps !== false;

  return (
    <div className="flex items-center justify-center gap-6 h-full">
      {/* Chart */}
      <div className="relative" style={{ width: height * 0.8, height: height * 0.9 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey={dataKey}
              cx="50%"
              cy="50%"
              innerRadius="55%"
              outerRadius="85%"
              paddingAngle={2}
              stroke="none"
              {...pieProps}
            >
              {data.map((_entry, index) => (
                <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={tooltipFormatter || ((value) => `${value}`)}
              contentStyle={chartTooltipStyle}
            />
          </PieChart>
        </ResponsiveContainer>

        {/* Center Label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">{totalFormatter(total)}</span>
          <span className="text-xs text-muted-foreground">Total</span>
        </div>
      </div>

      {/* Legend */}
      {shouldRenderLegend && (
        <div className="flex flex-col gap-2 max-h-full overflow-y-auto pr-2">
          {data.map((item, index) => (
            <div key={`legend-${index}`} className="flex items-center gap-2.5">
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: colors[index % colors.length] }}
              />
              <div className="flex items-baseline gap-2">
                <span className="text-sm text-muted-foreground truncate max-w-[120px]">
                  {item[nameKey]}
                </span>
                <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
                  {item[dataKey]}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PieChartComponent;
