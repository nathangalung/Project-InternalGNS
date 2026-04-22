import React from "react";

export interface Client {
  id: string;
  name: string;
  narahubung: string;
  country: string;
  initials: string;
}

interface Step1ClientProps {
  search: string;
  setSearch: (s: string) => void;
  filteredClients: Client[];
  selectedClient: string;
  setSelectedClient: (id: string) => void;
  setShowClientAdd: (show: boolean) => void;
}

export default function Step1Client({
  search, setSearch, filteredClients, selectedClient, setSelectedClient, setShowClientAdd
}: Step1ClientProps) {
  return (
    <div className="qe-step-content">
      <div className="qe-section-header">
        <div>
          <h2 className="qe-section-title">Pilih Klien Strategis</h2>
          <p className="qe-section-desc">Tentukan mitra bisnis untuk penawaran harga ini.</p>
        </div>
        <button className="qe-add-client-btn" onClick={() => setShowClientAdd(true)}>
          <svg width="16" height="14" viewBox="0 0 20 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 15v-1a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v1"/>
            <circle cx="8.5" cy="5" r="3"/>
            <line x1="17" y1="5" x2="17" y2="11"/>
            <line x1="14" y1="8" x2="20" y2="8"/>
          </svg>
          Tambah Klien Baru
        </button>
      </div>

      <div className="qe-search-wrapper">
        <svg className="qe-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          className="qe-search-input"
          type="text"
          placeholder="Cari nama perusahaan atau ID klien..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="qe-client-list">
        {filteredClients.map((client) => {
          const isSelected = client.id === selectedClient;
          return (
            <button
              key={client.id}
              className={`qe-client-item${isSelected ? " qe-client-item--selected" : ""}`}
              onClick={() => setSelectedClient(client.id)}
            >
              <div className="qe-client-avatar">
                <span className="qe-client-initials">{client.initials}</span>
              </div>
              <div className="qe-client-info">
                <span className="qe-client-name">{client.name} - {client.narahubung}</span>
                <span className="qe-client-country">
                  <svg width="9" height="12" viewBox="0 0 9 12" fill="none">
                    <path d="M4.5 0C2.015 0 0 2.015 0 4.5C0 7.875 4.5 12 4.5 12C4.5 12 9 7.875 9 4.5C9 2.015 6.985 0 4.5 0ZM4.5 6C3.672 6 3 5.328 3 4.5C3 3.672 3.672 3 4.5 3C5.328 3 6 3.672 6 4.5C6 5.328 5.328 6 4.5 6Z" fill="currentColor"/>
                  </svg>
                  {client.country}
                </span>
              </div>
              <div className={`qe-radio${isSelected ? " qe-radio--selected" : ""}`}>
                {isSelected && <div className="qe-radio-dot" />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}