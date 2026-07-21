import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, ScrollView, RefreshControl,
  FlatList, Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { API_URL } from '../config';
const DIAS_NOMBRE = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const { width: SW } = Dimensions.get('window');

export default function PlanScreen({ navigation }) {
  const [data, setData]             = useState(null);
  const [loading, setLoading]       = useState(true);
  const [refresh, setRefresh]       = useState(false);
  const [clienteId, setClienteId]   = useState(null);
  const [semanaIdx, setSemanaIdx]   = useState(0);

  const flatRef = useRef(null);

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

      const idx = json.semanas.findIndex(s => s.semana === json.semana_actual);
      const destino = idx >= 0 ? idx : 0;
      setSemanaIdx(destino);

      setTimeout(() => {
        flatRef.current?.scrollToIndex({ index: destino, animated: false });
      }, 50);

    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefresh(false);
    }
  };

  const completarDia = async (semana, dia) => {
    const token = await AsyncStorage.getItem('token');
    await fetch(
      `${API_URL}/cliente/${clienteId}/semana/${semana}/dia/${dia}/completar`,
      { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } }
    );
    cargar();
  };

  const irASemana = (idx) => {
    setSemanaIdx(idx);
    flatRef.current?.scrollToIndex({ index: idx, animated: true });
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
        <Text style={s.errorText}>Sin plan asignado</Text>
      </View>
    );
  }

  const semanas      = data.semanas;
  const semanaActual = data.semana_actual;
  const ultimaSemana = semanas.at(-1)?.semana ?? 1;

  return (
    <View style={s.root}>

      {/* ── Tabs de semanas ── */}
      <View style={s.tabsWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.tabsContent}
        >
          {semanas.map((sem, idx) => {
            const activo   = idx === semanaIdx;
            const esActual = sem.semana === semanaActual;
            const completa = sem.estado === 'completa';
            const futura   = sem.estado === 'futura';

            return (
              <TouchableOpacity
                key={sem.semana}
                style={[
                  s.tab,
                  activo   && s.tabActivo,
                  completa && !activo && s.tabCompleta,
                  futura   && s.tabFutura,
                ]}
                onPress={() => irASemana(idx)}
                activeOpacity={0.75}
              >
                {completa && !activo && (
                  <Text style={s.tabCheck}>✓</Text>
                )}
                <Text style={[
                  s.tabText,
                  activo && s.tabTextActivo,
                  futura && s.tabTextMuted,
                ]}>
                  S{sem.semana}
                </Text>
                {esActual && <View style={s.tabDot} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* ── Pager ── */}
      <FlatList
        ref={flatRef}
        data={semanas}
        keyExtractor={item => String(item.semana)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / SW);
          setSemanaIdx(idx);
        }}
        getItemLayout={(_, index) => ({
          length: SW, offset: SW * index, index,
        })}
        renderItem={({ item: sem }) => (
          <SemanaPage
            sem={sem}
            semanaActual={semanaActual}
            ultimaSemana={ultimaSemana}
            clienteId={clienteId}
            navigation={navigation}
            onCompletar={completarDia}
            refresh={refresh}
            onRefresh={() => cargar(true)}
          />
        )}
      />

      {/* ── Flechas ── */}
      <View style={s.flechasRow}>
        <TouchableOpacity
          style={[s.flecha, semanaIdx === 0 && s.flechaDisabled]}
          onPress={() => semanaIdx > 0 && irASemana(semanaIdx - 1)}
          disabled={semanaIdx === 0}
        >
          <Text style={s.flechaTxt}>‹</Text>
        </TouchableOpacity>

        <Text style={s.flechaInfo}>
          Semana {semanas[semanaIdx]?.semana ?? '–'} de {ultimaSemana}
        </Text>

        <TouchableOpacity
          style={[s.flecha, semanaIdx === semanas.length - 1 && s.flechaDisabled]}
          onPress={() => semanaIdx < semanas.length - 1 && irASemana(semanaIdx + 1)}
          disabled={semanaIdx === semanas.length - 1}
        >
          <Text style={s.flechaTxt}>›</Text>
        </TouchableOpacity>
      </View>

    </View>
  );
}

/* ─────────────────────────────────────────
   PÁGINA DE UNA SEMANA
───────────────────────────────────────── */
function SemanaPage({
  sem, semanaActual, ultimaSemana,
  clienteId, navigation,
  onCompletar, refresh, onRefresh,
}) {
  const esActual   = sem.semana === semanaActual;
  const isCompleta = sem.estado === 'completa';
  const isFutura   = sem.estado === 'futura';

  const diasConRutina  = sem.dias.filter(d => d.tiene_rutina);
  const diasHechos     = diasConRutina.filter(d => d.status === 'done').length;
  const progreso       = diasConRutina.length > 0 ? diasHechos / diasConRutina.length : 0;
  const semanaCompleta = diasConRutina.length > 0 && diasHechos === diasConRutina.length;

  const abrirRutina = (dia) => {
    if (!dia.tiene_rutina) return;
    navigation.navigate('Rutina', { clienteId, semana: sem.semana, dia: dia.dia });
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'done':    return '#22C55E';
      case 'pending': return '#3B82F6';
      case 'rest':    return '#334155';
      default:        return '#1E293B';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'done':    return '✓';
      case 'pending': return '▶';
      case 'rest':    return '😴';
      default:        return '🔒';
    }
  };

  return (
    <ScrollView
      style={{ width: SW }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        esActual
          ? <RefreshControl refreshing={refresh} onRefresh={onRefresh} tintColor="#3B82F6" />
          : undefined
      }
    >
      {/* ── Header ── */}
      <View style={s.semanaHeader}>
        <View style={s.semanaHeaderTop}>
          <View>
            <Text style={s.semanaTitulo}>Semana {sem.semana}</Text>
            <Text style={s.semanaFechas}>
              {formatFecha(sem.fecha_inicio)} – {formatFecha(sem.fecha_fin)}
            </Text>
          </View>
          <View style={[
            s.estadoBadge,
            isCompleta && s.estadoBadgeCompleta,
            esActual   && s.estadoBadgeActual,
            isFutura   && s.estadoBadgeFutura,
          ]}>
            <Text style={[
              s.estadoBadgeText,
              isCompleta && { color: '#22C55E' },
              esActual   && { color: '#3B82F6' },
              isFutura   && { color: '#475569' },
            ]}>
              {isCompleta ? '✓ Completa' : esActual ? 'En curso' : 'Próxima'}
            </Text>
          </View>
        </View>

        {!isFutura && diasConRutina.length > 0 && (
          <>
            <View style={s.progressBar}>
              <View style={[
                s.progressFill,
                { width: `${progreso * 100}%` },
                isCompleta && { backgroundColor: '#22C55E' },
              ]} />
            </View>
            <Text style={s.progressText}>
              {diasHechos} de {diasConRutina.length} entrenamientos
            </Text>
          </>
        )}
      </View>

      {/* ── Días ── */}
      <View style={s.diasContainer}>
        {sem.dias.map((dia) => {
          const isPending = dia.status === 'pending';
          const isDone    = dia.status === 'done';
          const isLocked  = dia.status === 'locked';
          const isRest    = dia.status === 'rest';
          const tappable  = (isPending || isDone) && dia.tiene_rutina;

          return (
            <TouchableOpacity
              key={dia.dia}
              style={[
                s.diaCard,
                isPending && s.diaCardPending,
                isDone    && s.diaCardDone,
                isLocked  && s.diaCardLocked,
                isRest    && s.diaCardRest,
              ]}
              onPress={() => tappable && abrirRutina(dia)}
              activeOpacity={tappable ? 0.75 : 1}
              disabled={!tappable}
            >
              <View style={s.diaLeft}>
                <View style={[s.diaNumero, { backgroundColor: getStatusColor(dia.status) }]}>
                  <Text style={s.diaNumeroText}>{getStatusIcon(dia.status)}</Text>
                </View>
                <View style={s.diaInfo}>
                  <Text style={[s.diaNombreDia, (isLocked || isRest) && s.textMuted]}>
                    {DIAS_NOMBRE[dia.dia]}
                  </Text>
                  <Text style={[s.diaNombre, (isLocked || isRest) && s.textMuted]}>
                    {isRest ? 'Descanso' : dia.nombre}
                  </Text>
                  {dia.fecha && (
                    <Text style={s.diaFecha}>{dia.fecha}</Text>
                  )}
                </View>
              </View>

              {isPending && dia.tiene_rutina && esActual && (
                <TouchableOpacity
                  style={s.btnCompletar}
                  onPress={() => onCompletar(sem.semana, dia.dia)}
                >
                  <Text style={s.btnCompletarText}>✓ Hecho</Text>
                </TouchableOpacity>
              )}

              {isDone && (
                <View style={s.doneTag}>
                  <Text style={s.doneTagText}>Completado</Text>
                </View>
              )}

              {isRest && (
                <View style={s.restTag}>
                  <Text style={s.restTagText}>Día libre</Text>
                </View>
              )}

              {tappable && (
                <Text style={[s.diaArrow, isDone && { color: '#22C55E' }]}>›</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Semana completa ── */}
      {semanaCompleta && (
        <View style={s.semanaCompletadaCard}>
          <Text style={s.semanaCompletadaText}>🎉 ¡Semana completada!</Text>
          <Text style={s.semanaCompletadaSub}>
            {sem.semana < ultimaSemana
              ? 'Desliza a la derecha para ver la siguiente →'
              : '¡Has terminado el plan completo! 🏆'}
          </Text>
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

/* ─────────────────────────────────────────
   HELPERS
───────────────────────────────────────── */
function formatFecha(dateStr) {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('-');
  const meses = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
                      'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return `${parseInt(d)} ${meses[parseInt(m)]}`;
}

/* ─────────────────────────────────────────
   ESTILOS
───────────────────────────────────────── */
const s = StyleSheet.create({
  root:      { flex: 1, backgroundColor: '#0F172A' },
  center:    { flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center' },
  errorText: { color: '#94A3B8', fontSize: 16 },

  // Tabs
  tabsWrap:    { backgroundColor: '#0F172A', borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  tabsContent: { paddingHorizontal: 12, paddingVertical: 10, gap: 6, flexDirection: 'row' },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 99,
    backgroundColor: '#1E293B',
    position: 'relative',
  },
  tabActivo:     { backgroundColor: '#3B82F6' },
  tabCompleta:   { backgroundColor: '#14532D', borderWidth: 1, borderColor: '#166534' },
  tabFutura:     { opacity: 0.45 },
  tabCheck:      { color: '#22C55E', fontSize: 11, fontWeight: '700' },
  tabText:       { color: '#94A3B8', fontSize: 13, fontWeight: '600' },
  tabTextActivo: { color: 'white' },
  tabTextMuted:  { color: '#475569' },
  tabDot: {
    position: 'absolute',
    top: 3, right: 3,
    width: 6, height: 6,
    borderRadius: 3,
    backgroundColor: '#F59E0B',
  },

  // Flechas
  flechasRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    backgroundColor: '#0F172A',
  },
  flecha: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#1E293B',
    justifyContent: 'center', alignItems: 'center',
  },
  flechaDisabled: { opacity: 0.25 },
  flechaTxt:      { color: '#F1F5F9', fontSize: 26, lineHeight: 30 },
  flechaInfo:     { color: '#64748B', fontSize: 13, fontWeight: '600' },

  // Header semana
  semanaHeader: { padding: 20, paddingBottom: 14 },
  semanaHeaderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  semanaTitulo: { color: '#F8FAFC', fontSize: 22, fontWeight: 'bold' },
  semanaFechas: { color: '#64748B', fontSize: 13, marginTop: 3 },

  estadoBadge: {
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 99, borderWidth: 1,
    borderColor: '#334155', backgroundColor: '#1E293B',
  },
  estadoBadgeActual:   { borderColor: '#3B82F6', backgroundColor: '#1E3A5F' },
  estadoBadgeCompleta: { borderColor: '#166534', backgroundColor: '#14532D' },
  estadoBadgeFutura:   { borderColor: '#334155' },
  estadoBadgeText:     { fontSize: 12, fontWeight: '700', color: '#94A3B8' },

  progressBar:  { height: 6, backgroundColor: '#1E293B', borderRadius: 99, overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: 6, backgroundColor: '#3B82F6', borderRadius: 99 },
  progressText: { color: '#64748B', fontSize: 12 },

  // Días
  diasContainer: { paddingHorizontal: 16, paddingBottom: 8 },

  diaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  diaCardPending: { borderColor: '#3B82F6', backgroundColor: '#1E3A5F' },
  diaCardDone:    { borderColor: '#166534', backgroundColor: '#14532D22' },
  diaCardLocked:  { opacity: 0.4 },
  diaCardRest:    { opacity: 0.5, borderColor: '#334155' },

  diaLeft:      { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12 },
  diaNumero:    { width: 38, height: 38, borderRadius: 10, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  diaNumeroText:{ color: 'white', fontSize: 16, fontWeight: 'bold' },
  diaInfo:      { flex: 1 },
  diaNombreDia: { color: '#64748B', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  diaNombre:    { color: '#F1F5F9', fontSize: 15, fontWeight: '600', marginTop: 1 },
  diaFecha:     { color: '#475569', fontSize: 11, marginTop: 2 },
  textMuted:    { color: '#475569' },
  diaArrow:     { color: '#3B82F6', fontSize: 22, marginLeft: 8 },

  btnCompletar:     { backgroundColor: '#22C55E', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, marginLeft: 8 },
  btnCompletarText: { color: 'white', fontSize: 13, fontWeight: '700' },

  doneTag:     { backgroundColor: '#14532D', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, marginLeft: 8 },
  doneTagText: { color: '#22C55E', fontSize: 12, fontWeight: '600' },

  restTag:     { backgroundColor: '#1E293B', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, marginLeft: 8, borderWidth: 1, borderColor: '#334155' },
  restTagText: { color: '#475569', fontSize: 12, fontWeight: '600' },

  // Semana completa
  semanaCompletadaCard: {
    margin: 16,
    backgroundColor: '#1E3A5F',
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3B82F6',
  },
  semanaCompletadaText: { color: '#F1F5F9', fontSize: 18, fontWeight: 'bold', marginBottom: 6 },
  semanaCompletadaSub:  { color: '#64748B', fontSize: 13, textAlign: 'center' },
});