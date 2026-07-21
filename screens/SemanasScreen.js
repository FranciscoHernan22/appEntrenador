import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, ScrollView, RefreshControl,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { API_URL } from '../config';
const DIAS_NOMBRE = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export default function SemanasScreen({ navigation }) {
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [refresh, setRefresh]   = useState(false);
  const [clienteId, setClienteId] = useState(null);
  const [expandida, setExpandida] = useState(null); // semana abierta

  useEffect(() => {
    AsyncStorage.getItem('cliente_id').then(id => {
      if (id) setClienteId(parseInt(id));
    });
  }, []);

  useEffect(() => {
    if (!clienteId) return;
    cargar();
    const unsub = navigation.addListener('focus', () => cargar());
    return unsub;
  }, [clienteId, navigation]);

  const cargar = async (esRefresh = false) => {
    if (!clienteId) return;
    if (esRefresh) setRefresh(true); else setLoading(true);
    try {
      const token = await AsyncStorage.getItem('token');
      const res   = await fetch(`${API_URL}/cliente/${clienteId}/semanas`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const json = await res.json();
      setData(json);
      // Abrir la semana actual por defecto
      setExpandida(json.semana_actual);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefresh(false);
    }
  };

  const abrirRutina = (semana, dia) => {
    navigation.navigate('Rutina', { clienteId, semana, dia });
  };

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={s.center}>
        <Text style={s.errorText}>Sin datos</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={s.container}
      refreshControl={
        <RefreshControl
          refreshing={refresh}
          onRefresh={() => cargar(true)}
          tintColor="#3B82F6"
        />
      }
    >
      <View style={s.headerGlobal}>
        <Text style={s.headerTitle}>{data.cliente}</Text>
        <Text style={s.headerSub}>
          {data.semanas.length} semanas en total
        </Text>
      </View>

      {data.semanas.map((sem) => {
        const isActual   = sem.estado === 'actual';
        const isCompleta = sem.estado === 'completa';
        const isFutura   = sem.estado === 'futura';
        const abierta    = expandida === sem.semana;
        const progreso   = sem.total > 0 ? sem.hechos / sem.total : 0;

        return (
          <View key={sem.semana} style={[
            s.semanaCard,
            isActual   && s.semanaCardActual,
            isCompleta && s.semanaCardCompleta,
            isFutura   && s.semanaCardFutura,
          ]}>

            {/* ── Cabecera de semana (tap para expandir) ── */}
            <TouchableOpacity
              style={s.semanaHeader}
              onPress={() => setExpandida(abierta ? null : sem.semana)}
              activeOpacity={0.75}
            >
              <View style={s.semanaHeaderLeft}>
                <View style={[
                  s.semanaNumBadge,
                  isActual   && { backgroundColor: '#3B82F6' },
                  isCompleta && { backgroundColor: '#22C55E' },
                  isFutura   && { backgroundColor: '#334155' },
                ]}>
                  <Text style={s.semanaNumText}>{sem.semana}</Text>
                </View>

                <View>
                  <View style={s.semanaLabelRow}>
                    <Text style={[s.semanaTitulo, isFutura && s.textMuted]}>
                      Semana {sem.semana}
                    </Text>
                    {isActual && (
                      <View style={s.badgeActual}>
                        <Text style={s.badgeActualText}>EN CURSO</Text>
                      </View>
                    )}
                    {isCompleta && (
                      <View style={s.badgeCompleta}>
                        <Text style={s.badgeCompletaText}>✓ COMPLETA</Text>
                      </View>
                    )}
                  </View>
                  <Text style={s.semanaFechas}>
                    {formatFecha(sem.fecha_inicio)} – {formatFecha(sem.fecha_fin)}
                  </Text>
                </View>
              </View>

              <View style={s.semanaHeaderRight}>
                {!isFutura && (
                  <Text style={[
                    s.semanaContador,
                    isCompleta && { color: '#22C55E' },
                    isActual   && { color: '#3B82F6' },
                  ]}>
                    {sem.hechos}/{sem.total}
                  </Text>
                )}
                <Text style={[s.chevron, abierta && s.chevronOpen]}>›</Text>
              </View>
            </TouchableOpacity>

            {/* ── Barra de progreso mini ── */}
            {!isFutura && sem.total > 0 && (
              <View style={s.miniProgressWrap}>
                <View style={s.miniProgress}>
                  <View style={[
                    s.miniProgressFill,
                    { width: `${progreso * 100}%` },
                    isCompleta && { backgroundColor: '#22C55E' },
                  ]} />
                </View>
              </View>
            )}

            {/* ── Detalle de días (expandible) ── */}
            {abierta && (
              <View style={s.diasWrap}>
                {sem.dias.map((dia) => {
                  const isDone    = dia.status === 'done';
                  const isPending = dia.status === 'pending';
                  const isRest    = dia.status === 'rest';
                  const isLocked  = dia.status === 'locked';
                  const tappable  = (isDone || isPending) && dia.tiene_rutina;

                  return (
                    <TouchableOpacity
                      key={dia.dia}
                      style={[
                        s.diaRow,
                        isDone    && s.diaRowDone,
                        isPending && s.diaRowPending,
                        isRest    && s.diaRowRest,
                        isLocked  && s.diaRowLocked,
                      ]}
                      onPress={() => tappable && abrirRutina(sem.semana, dia.dia)}
                      activeOpacity={tappable ? 0.75 : 1}
                      disabled={!tappable}
                    >
                      {/* Icono estado */}
                      <View style={[
                        s.diaIcono,
                        isDone    && { backgroundColor: '#22C55E' },
                        isPending && { backgroundColor: '#3B82F6' },
                        isRest    && { backgroundColor: '#334155' },
                        isLocked  && { backgroundColor: '#1E293B' },
                      ]}>
                        <Text style={s.diaIconoText}>
                          {isDone    ? '✓'  : ''}
                          {isPending ? '▶'  : ''}
                          {isRest    ? '😴' : ''}
                          {isLocked  ? '🔒' : ''}
                        </Text>
                      </View>

                      {/* Info */}
                      <View style={s.diaInfo}>
                        <Text style={[s.diaNombreDia, DIAS_NOMBRE[dia.dia] && {}]}>
                          {DIAS_NOMBRE[dia.dia]}
                        </Text>
                        <Text style={[s.diaNombre, (isRest || isLocked) && s.textMuted]}>
                          {isRest ? 'Descanso' : dia.nombre}
                        </Text>
                      </View>

                      {/* Flecha si es navegable */}
                      {tappable && (
                        <Text style={s.diaArrow}>›</Text>
                      )}

                      {/* Tag descanso */}
                      {isRest && (
                        <View style={s.restTag}>
                          <Text style={s.restTagText}>Día libre</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function formatFecha(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  const meses = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
                      'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return `${parseInt(d)} ${meses[parseInt(m)]}`;
}

const s = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#0F172A' },
  center:     { flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center' },
  errorText:  { color: '#94A3B8', fontSize: 16 },

  headerGlobal: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
  headerTitle:  { color: '#F8FAFC', fontSize: 22, fontWeight: 'bold' },
  headerSub:    { color: '#64748B', fontSize: 13, marginTop: 2 },

  // Tarjeta semana
  semanaCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#1E293B',
    overflow: 'hidden',
  },
  semanaCardActual:   { borderColor: '#3B82F6', backgroundColor: '#1E3A5F' },
  semanaCardCompleta: { borderColor: '#166534', backgroundColor: '#14532D22' },
  semanaCardFutura:   { opacity: 0.5 },

  // Cabecera semana
  semanaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  semanaHeaderLeft:  { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  semanaHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  semanaNumBadge: {
    width: 40, height: 40, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#334155',
  },
  semanaNumText: { color: 'white', fontWeight: 'bold', fontSize: 16 },

  semanaLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  semanaTitulo:   { color: '#F1F5F9', fontSize: 15, fontWeight: '700' },
  semanaFechas:   { color: '#64748B', fontSize: 12 },

  badgeActual: {
    backgroundColor: '#1E3A5F', borderRadius: 99,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: '#3B82F6',
  },
  badgeActualText: { color: '#3B82F6', fontSize: 9, fontWeight: '700' },

  badgeCompleta: {
    backgroundColor: '#14532D', borderRadius: 99,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: '#22C55E',
  },
  badgeCompletaText: { color: '#22C55E', fontSize: 9, fontWeight: '700' },

  semanaContador: { color: '#64748B', fontSize: 13, fontWeight: '700' },
  chevron:        { color: '#64748B', fontSize: 22, fontWeight: '300', marginLeft: 4 },
  chevronOpen:    { transform: [{ rotate: '90deg' }] },

  // Barra mini
  miniProgressWrap: { paddingHorizontal: 14, paddingBottom: 10 },
  miniProgress:     { height: 4, backgroundColor: '#0F172A', borderRadius: 99, overflow: 'hidden' },
  miniProgressFill: { height: 4, backgroundColor: '#3B82F6', borderRadius: 99 },

  // Días expandidos
  diasWrap: { borderTopWidth: 1, borderTopColor: '#0F172A20', paddingVertical: 6 },

  diaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#0F172A30',
  },
  diaRowDone:    { backgroundColor: '#14532D15' },
  diaRowPending: { backgroundColor: '#1E3A5F40' },
  diaRowRest:    { opacity: 0.6 },
  diaRowLocked:  { opacity: 0.35 },

  diaIcono: {
    width: 32, height: 32, borderRadius: 8,
    justifyContent: 'center', alignItems: 'center',
    flexShrink: 0,
  },
  diaIconoText: { fontSize: 13, color: 'white', fontWeight: 'bold' },

  diaInfo:     { flex: 1 },
  diaNombreDia: { color: '#64748B', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  diaNombre:   { color: '#F1F5F9', fontSize: 14, fontWeight: '600', marginTop: 1 },
  textMuted:   { color: '#475569' },

  diaArrow: { color: '#3B82F6', fontSize: 20 },

  restTag:     { backgroundColor: '#1E293B', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: '#334155' },
  restTagText: { color: '#475569', fontSize: 11, fontWeight: '600' },
});