import React from 'react';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip
} from 'recharts';
import { TagWeight } from '../types';

interface TasteChartProps {
  data: TagWeight[];
}

const TasteChart: React.FC<TasteChartProps> = ({ data }) => {
  // Filter top 8 for the chart to keep it clean
  const chartData = [...data]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8);

  return (
    <div className="w-full h-80 bg-white rounded-xl shadow-sm border border-slate-100 p-4">
      <h3 className="text-lg font-semibold text-slate-800 mb-4 font-serif">Taste Profile</h3>
      <div className="w-full h-64">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius="80%" data={chartData}>
            <PolarGrid stroke="#e2e8f0" />
            <PolarAngleAxis 
              dataKey="tag" 
              tick={{ fill: '#64748b', fontSize: 12 }} 
            />
            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
            <Radar
              name="Interest Level"
              dataKey="weight"
              stroke="#0f172a"
              strokeWidth={2}
              fill="#3b82f6"
              fillOpacity={0.3}
            />
            <Tooltip 
              contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }}
              itemStyle={{ color: '#0f172a' }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-center text-slate-500 mt-2">
        Based on your ratings, the system learns what you enjoy.
      </p>
    </div>
  );
};

export default TasteChart;