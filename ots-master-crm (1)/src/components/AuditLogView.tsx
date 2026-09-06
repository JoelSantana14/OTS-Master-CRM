import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  ShieldCheck,
  Search,
  Download,
  Filter,
  Clock,
  User,
  Layers,
  FileSpreadsheet,
} from 'lucide-react';

export const AuditLogView: React.FC = () => {
  const { auditLogs } = useApp();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEntidade, setSelectedEntidade] = useState('todas');

  const visibleLogs = useMemo(() => {
    return auditLogs.filter((log) => {
      const matchesSearch =
        log.acao.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.detalhes.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesEntidade = selectedEntidade === 'todas' || log.entidade === selectedEntidade;

      return matchesSearch && matchesEntidade;
    });
  }, [auditLogs, searchTerm, selectedEntidade]);

  const entidades = useMemo(() => {
    const set = new Set<string>();
    auditLogs.forEach((l) => set.add(l.entidade));
    return Array.from(set);
  }, [auditLogs]);

  const exportCsv = () => {
    const headers = ['Data/Hora', 'Usuário', 'Ação', 'Módulo/Entidade', 'Detalhes'];
    const rows = visibleLogs.map((l) => [
      l.timestamp,
      `"${l.userName}"`,
      `"${l.acao}"`,
      `"${l.entidade}"`,
      `"${l.detalhes.replace(/"/g, '""')}"`,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `auditoria_jardim_vivencia_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Auditoria & Registro de Atividades</h1>
            <span className="px-2.5 py-0.5 rounded-md text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
              Exclusivo Administrador
            </span>
          </div>
          <p className="text-sm text-slate-600 mt-0.5">
            Rastreabilidade e log de todas as operações de vendas, alterações na tabela, permissões e roleta.
          </p>
        </div>

        <button
          onClick={exportCsv}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition-colors"
        >
          <Download className="w-4 h-4" />
          <span>Exportar Relatório de Auditoria</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por usuário, ação ou detalhe..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 text-slate-800"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs text-slate-500 font-medium">Módulo:</span>
          <select
            value={selectedEntidade}
            onChange={(e) => setSelectedEntidade(e.target.value)}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700"
          >
            <option value="todas">Todos os Módulos</option>
            {entidades.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold uppercase tracking-wider text-[11px]">
              <tr>
                <th className="px-4 py-3.5">Data/Horário</th>
                <th className="px-4 py-3.5">Usuário Responsável</th>
                <th className="px-4 py-3.5">Ação Realizada</th>
                <th className="px-4 py-3.5">Módulo / Entidade</th>
                <th className="px-4 py-3.5">Detalhes da Operação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {visibleLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-500 font-mono text-[11px]">{log.timestamp}</td>
                  <td className="px-4 py-3 font-bold text-slate-900">{log.userName}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800">{log.acao}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700">
                      {log.entidade}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600 max-w-md break-words">{log.detalhes}</td>
                </tr>
              ))}

              {visibleLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                    Nenhum registro de auditoria encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
