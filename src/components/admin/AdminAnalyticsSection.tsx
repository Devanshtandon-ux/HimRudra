import React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatINR, type ProfitSummary } from '../../lib/commerce';
import type { Product } from '../../types';

interface AdminAnalyticsSectionProps {
  analytics: ProfitSummary;
  products: Product[];
}

const STATUS_COLORS = [
  '#281A15',
  '#79543D',
  '#C69B51',
  '#4B6B50',
  '#8C6D46',
  '#A67B5B',
  '#166534',
  '#991B1B',
  '#B45309',
];

export const AdminAnalyticsSection: React.FC<AdminAnalyticsSectionProps> = ({
  analytics,
  products,
}) => {
  const totalStock = products.reduce((s, p) => s + p.stock, 0);

  const kpiCards = [
    {
      label: 'Total Revenue',
      value: formatINR(analytics.grossRevenue),
      sub: `${analytics.totalOrders} active orders · AOV ${formatINR(analytics.averageOrderValue)}`,
    },
    {
      label: 'Total Paid Orders',
      value: String(analytics.totalPaidOrders),
      sub: `${totalStock} jars remaining in inventory`,
    },
    {
      label: 'Total Sales Today',
      value: formatINR(analytics.totalSalesToday),
      sub: 'IST day revenue (excluding cancelled/refunded)',
    },
    {
      label: 'Monthly Revenue',
      value: formatINR(analytics.monthlyRevenue),
      sub: 'Current calendar month (IST)',
    },
    {
      label: 'Annual Revenue',
      value: formatINR(analytics.annualRevenue),
      sub: 'Current calendar year (IST)',
    },
    {
      label: 'Product Costs',
      value: formatINR(analytics.totalCogs),
      sub: 'COGS across fulfilled & active units',
    },
    {
      label: 'Shipping Expenses',
      value: formatINR(analytics.shippingExpenses),
      sub: `Shipping collected: ${formatINR(analytics.totalShippingCollected)}`,
    },
    {
      label: 'Payment Gateway Fees',
      value: formatINR(analytics.gatewayFees),
      sub: 'Configured fee deduction on online payments',
    },
    {
      label: 'Refunds',
      value: formatINR(analytics.refundsTotal),
      sub: 'Total refunded order value',
    },
    {
      label: 'Estimated Net Profit',
      value: formatINR(analytics.netProfit),
      sub:
        analytics.totalOrders === 0 && analytics.operatingExpenses === 0
          ? 'No profit or loss yet — updates live on orders'
          : `${analytics.profitMarginPercent}% net margin after costs & fees`,
      highlight: true,
    },
  ];

  const renderEmptyChart = (caption: string) => (
    <div className="h-64 w-full rounded-lg border border-dashed border-[#79543D]/20 bg-[#F3EDE5]/35 flex flex-col items-center justify-center text-center px-6">
      <p className="font-mono text-lg font-semibold text-[#281A15]">₹0</p>
      <p className="mt-1 text-xs text-[#79543D] max-w-xs leading-relaxed">{caption}</p>
    </div>
  );

  return (
    <div className="space-y-6" data-testid="admin-analytics-section">
      {/* 10 Analytical Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {kpiCards.map((kpi) => (
          <div
            key={kpi.label}
            className={`rounded-xl border p-4 ${
              kpi.highlight
                ? 'border-[#C69B51]/70 bg-gradient-to-br from-[#F3EDE5] to-[#FAF8F4]'
                : 'border-[#79543D]/18 bg-[#F3EDE5]/55'
            }`}
          >
            <div className="text-[11px] uppercase tracking-wider text-[#79543D] font-semibold">
              {kpi.label}
            </div>
            <div className="mt-1.5 font-mono text-xl font-semibold text-[#281A15] tabular-nums">
              {kpi.value}
            </div>
            <div className="mt-1 text-[11px] text-[#241B17]/65 tabular-nums leading-snug">
              {kpi.sub}
            </div>
          </div>
        ))}
      </div>

      {/* 6 Analytical Graphs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. Daily Sales Graph */}
        <div className="rounded-xl border border-[#79543D]/18 bg-[#FAF8F4] p-5">
          <h4 className="font-serif text-lg font-semibold text-[#281A15] mb-3">
            Daily Sales Graph (INR)
          </h4>
          {analytics.dailySales.length === 0 ? (
            renderEmptyChart('No daily sales yet. Live revenue will plot here as soon as customers purchase.')
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={analytics.dailySales}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5DACB" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#79543D' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#79543D' }} />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    name="Daily Revenue (₹)"
                    stroke="#79543D"
                    fill="#C69B51"
                    fillOpacity={0.32}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* 2. Weekly Orders Graph */}
        <div className="rounded-xl border border-[#79543D]/18 bg-[#FAF8F4] p-5">
          <h4 className="font-serif text-lg font-semibold text-[#281A15] mb-3">
            Weekly Orders Graph
          </h4>
          {analytics.weeklyOrders.length === 0 ? (
            renderEmptyChart('0 orders recorded. Weekly order volume will update live with every checkout.')
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.weeklyOrders}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5DACB" />
                  <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#79543D' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#79543D' }} />
                  <Tooltip />
                  <Bar dataKey="orders" name="Orders Count" fill="#281A15" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* 3. Monthly Revenue Chart */}
        <div className="rounded-xl border border-[#79543D]/18 bg-[#FAF8F4] p-5">
          <h4 className="font-serif text-lg font-semibold text-[#281A15] mb-3">
            Monthly Revenue Chart (INR)
          </h4>
          {analytics.monthlySeries.length === 0 ? (
            renderEmptyChart('No monthly revenue yet. Monthly totals update automatically from live purchases.')
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.monthlySeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5DACB" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#79543D' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#79543D' }} />
                  <Tooltip />
                  <Bar dataKey="revenue" name="Monthly Revenue (₹)" fill="#C69B51" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* 4. Annual Sales Chart */}
        <div className="rounded-xl border border-[#79543D]/18 bg-[#FAF8F4] p-5">
          <h4 className="font-serif text-lg font-semibold text-[#281A15] mb-3">
            Annual Sales Chart (INR)
          </h4>
          {analytics.annualSales.length === 0 ? (
            renderEmptyChart('No annual sales yet. Revenue and estimated profit will appear live here.')
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={analytics.annualSales}
                  margin={{ top: 8, right: 12, bottom: 0, left: 6 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5DACB" />
                  <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#79543D' }} />
                  <YAxis width={68} tick={{ fontSize: 11, fill: '#79543D' }} />
                  <ReferenceLine y={0} stroke="#79543D" strokeOpacity={0.35} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="revenue" name="Annual Revenue (₹)" fill="#79543D" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="profit" name="Estimated Profit (₹)" fill="#166534" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* 5. Profit & Loss Chart */}
        <div className="rounded-xl border border-[#79543D]/18 bg-[#FAF8F4] p-5">
          <h4 className="font-serif text-lg font-semibold text-[#281A15] mb-3">
            Profit & Loss Chart (Monthly INR)
          </h4>
          {analytics.monthlySeries.length === 0 ? (
            renderEmptyChart('No profit or loss recorded yet. Live P&L updates as orders and expenses come in.')
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={analytics.monthlySeries}
                  margin={{ top: 8, right: 12, bottom: 0, left: 6 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5DACB" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#79543D' }} />
                  <YAxis width={68} tick={{ fontSize: 11, fill: '#79543D' }} />
                  <ReferenceLine y={0} stroke="#79543D" strokeOpacity={0.35} />
                  <Tooltip />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    name="Revenue"
                    stroke="#281A15"
                    fill="#C69B51"
                    fillOpacity={0.28}
                  />
                  <Area
                    type="monotone"
                    dataKey="expenses"
                    name="All Costs & Expenses"
                    stroke="#79543D"
                    fill="#79543D"
                    fillOpacity={0.18}
                  />
                  <Area
                    type="monotone"
                    dataKey="profit"
                    name="Estimated Net Profit"
                    stroke="#166534"
                    fill="#166534"
                    fillOpacity={0.16}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* 6. Order Status Distribution */}
        <div className="rounded-xl border border-[#79543D]/18 bg-[#FAF8F4] p-5">
          <h4 className="font-serif text-lg font-semibold text-[#281A15] mb-3">
            Order Status Distribution
          </h4>
          {analytics.statusDistribution.length === 0 ? (
            renderEmptyChart('No order statuses yet. Live dispatch breakdown will appear after your first order.')
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={analytics.statusDistribution}
                    dataKey="count"
                    nameKey="status"
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={82}
                    paddingAngle={2}
                  >
                    {analytics.statusDistribution.map((entry, idx) => (
                      <Cell
                        key={entry.status}
                        fill={STATUS_COLORS[idx % STATUS_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
