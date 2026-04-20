import { useState } from "react";
import type { Page } from "../../main";
import Sidebar from "../shared/Sidebar";

const chartTabs = ["Quotation", "Invoice", "Pendapatan", "Laba Bersih", "PPN"];
const months = ["JAN", "FEB", "MAR", "APR", "MEI", "JUN", "JUL", "AGS"];

const allData: Record<string, number[]> = {
  Quotation:      [30, 48, 36, 58, 50, 68, 54, 62],
  Invoice:        [24, 40, 30, 50, 44, 60, 48, 56],
  Pendapatan:     [75, 108, 88, 128, 112, 148, 124, 140],
  "Laba Bersih":  [38, 56, 45, 68, 60, 80, 66, 74],
  PPN:            [10, 16, 13, 20, 17, 24, 20, 22],
};

const lineColors: Record<string, string> = {
  Quotation:     "#7C3AED",
  Invoice:       "#0F172A",
  Pendapatan:    "#F59E0B",
  "Laba Bersih": "#22C55E",
  PPN:           "#EF4444",
};

function TrendChart({ activeTab }: { activeTab: string }) {
  const W = 760, H = 190;
  const PAD = { top: 16, right: 16, bottom: 32, left: 52 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;
  const maxVal = 160;

  const gx = (i: number) => PAD.left + (i / (months.length - 1)) * cW;
  const gy = (v: number) => PAD.top + cH - (v / maxVal) * cH;
  const makePath = (data: number[]) =>
    data.map((v, i) => `${i === 0 ? "M" : "L"} ${gx(i).toFixed(1)} ${gy(v).toFixed(1)}`).join(" ");
  const yTicks = [0, 25, 50, 75, 100, 125, 150];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg">
      {yTicks.map((tick) => (
        <g key={tick}>
          <line x1={PAD.left} y1={gy(tick)} x2={W - PAD.right} y2={gy(tick)} stroke="#E2E8F0" strokeWidth="1" />
          {tick > 0 && (
            <text x={PAD.left - 6} y={gy(tick) + 4} textAnchor="end" fontSize="10" fill="#94A3B8">
              Rp {tick}K
            </text>
          )}
        </g>
      ))}
      {months.map((m, i) => (
        <text key={m} x={gx(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="#94A3B8">{m}</text>
      ))}
      {Object.entries(allData).map(([key, data]) => {
        const isActive = key === activeTab;
        return (
          <path
            key={key}
            d={makePath(data)}
            fill="none"
            stroke={lineColors[key]}
            strokeWidth={isActive ? 2.5 : 1.5}
            strokeOpacity={isActive ? 1 : 0.25}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
      {(allData[activeTab] ?? []).map((v, i) => (
        <circle key={i} cx={gx(i)} cy={gy(v)} r={3.5} fill={lineColors[activeTab]} />
      ))}
    </svg>
  );
}

interface MainDashboardProps {
  onLogout: () => void;
  onNavigate: (page: Page) => void;
}

export default function MainDashboard({ onLogout, onNavigate }: MainDashboardProps) {
  const [activeTab, setActiveTab] = useState("Quotation");

  return (
    <div className="admin-shell">
      <Sidebar activePage="dashboard" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        {/* Header */}
        <header className="dash-header">
          <h1>Dashboard Utama</h1>
          <div className="page-actions">
            <button className="btn-admin-filter">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="6" x2="20" y2="6"/>
                <line x1="7" y1="12" x2="17" y2="12"/>
                <line x1="10" y1="18" x2="14" y2="18"/>
              </svg>
              Filter
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="page-content">

          {/* Row 1 */}
          <div className="stats-grid-3">
            <div className="stat-card">
              <div className="stat-label">Total Pendapatan</div>
              <div className="stat-value">Rp365.630.000</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total Pengeluaran</div>
              <div className="stat-value">Rp147.915.357,1</div>
            </div>
            <div className="stat-card stat-card--accent">
              <div className="stat-label">Total Purchase Order</div>
              <div className="stat-value">750</div>
            </div>
          </div>

          {/* Row 2 */}
          <div className="stats-grid-3">
            <div className="stat-card">
              <div className="stat-label">Total Laba Bersih</div>
              <div className="stat-value">Rp178.540.000</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total PPN</div>
              <div className="stat-value">Rp39.174.642,9</div>
            </div>
            <div className="stat-card stat-card--accent-light">
              <div
                className="card-overlay"
                style={{ background: "linear-gradient(82.48deg, rgba(63,86,255,.5) 6.42%, #DBEAFE 93.58%)", opacity: 0.5 }}
              />
              <div className="stat-label">Total Invoice</div>
              <div className="stat-value">750</div>
            </div>
          </div>

          {/* Row 3 */}
          <div className="stats-grid-4">
            <div className="stat-card">
              <div className="stat-label">Total Quotation</div>
              <div className="stat-value">325</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total Quotation Ditolak</div>
              <div className="stat-value">53</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total Purchase Order</div>
              <div className="stat-value">272</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total Invoice Dibayar</div>
              <div className="stat-value">269</div>
            </div>
          </div>

          {/* Chart */}
          <div className="chart-section">
            <div className="chart-header">
              <h3 className="chart-title">Tren Performa</h3>
              <div className="chart-tabs">
                {chartTabs.map((tab) => (
                  <button
                    key={tab}
                    className={`chart-tab${activeTab === tab ? " chart-tab--active" : ""}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>
            <TrendChart activeTab={activeTab} />
          </div>

          {/* Alerts */}
          <div className="alert-row">
            <div className="alert-card alert--warning">
              <div
                className="card-overlay"
                style={{ background: "linear-gradient(82.48deg, rgba(217,119,6,.5) 6.42%, rgba(245,158,11,.1) 93.58%)", opacity: 0.5 }}
              />
              <div className="alert-content">
                <h3>3 Invoice</h3>
                <p>Invoice akan segera jatuh tempo</p>
              </div>
              <button className="alert-btn">Tinjau</button>
            </div>
            <div className="alert-card alert--danger">
              <div
                className="card-glow"
                style={{ background: "rgba(239,94,94,.3)" }}
              />
              <div className="alert-content">
                <h3>3 Invoice</h3>
                <p>Invoice telah jatuh tempo</p>
              </div>
              <button className="alert-btn">Tinjau</button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
