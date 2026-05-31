import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE_URL = 'http://192.168.0.254:8000/api';

export default function HomeScreen({ navigation }) {
  const [plan, setPlan]               = useState(null);
  const [loading, setLoading]         = useState(true);
  const [refresh, setRefresh]         = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);

  const cargarPlan = async (esRefresh = false) => {
    if (esRefresh) setRefresh(true); else setLoading(true);
    try {
      const id    = await AsyncStorage.getItem('cliente_id');
      const token = await AsyncStorage.getItem('token');
      if (!id || !token) { setLoading(false); return; }

      const res  = await fetch(`${BASE_URL}/cliente/${id}/semana-actual`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type':  'application/json',
        },
      });
      const text = await res.text();
      const data = JSON.parse(text);
      setPlan(data);
    } catch (e) {
      console.error('Error cargarPlan:', e);
    } finally {
      setLoading(false);
      setRefresh(false);
    }
  };

  useEffect(() => {
    cargarPlan();
    const unsub = navigation.addListener('focus', () => cargarPlan());
    return unsub;
  }, [navigation]);

  const handleLogout = async () => {
    setMenuVisible(false);
    await AsyncStorage.removeItem('token');
    await AsyncStorage.removeItem('cliente_id');
    await AsyncStorage.removeItem('nombre');
    navigation.replace('Login');
  };

  const getInitials = (nombre) =>
    nombre?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() ?? '??';

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  if (!plan) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Sin plan asignado</Text>
      </View>
    );
  }

  const diaPendiente    = plan.dias.find(d => d.status === 'pending');
  const diasCompletados = plan.dias.filter(d => d.status === 'done').length;
  const progreso        = diasCompletados / 7;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refresh}
            onRefresh={() => cargarPlan(true)}
            tintColor="#3B82F6"
          />
        }
      >

        {/* ── Header normal (cuando el menú está cerrado) ── */}
        {!menuVisible && (
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.profileRow}
onPress={() => setMenuVisible(!menuVisible)}
              activeOpacity={0.8}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {getInitials(plan.cliente)}
                </Text>
              </View>
              <View>
                <Text style={styles.profileName}>{plan.cliente}</Text>
                <Text style={styles.profileSub}>Cliente activo</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>

            <View style={styles.semanaChip}>
              <Text style={styles.semanaChipText}>
                Sem {plan.semana_actual}/{plan.semana_fin}
              </Text>
            </View>
          </View>
        )}

        {/* ── Menú abierto (reemplaza el header) ── */}
        {menuVisible && (
          <View style={styles.menuWrap}>

            {/* Fila superior: avatar + nombre + chip + X */}
            <View style={styles.menuTopRow}>
             <TouchableOpacity
  style={styles.menuUserRow}
  onPress={() => setMenuVisible(false)}
  activeOpacity={0.8}
>
  <View style={styles.avatar}>
    <Text style={styles.avatarText}>
      {getInitials(plan.cliente)}
    </Text>
  </View>
  <View>
    <Text style={styles.profileName}>{plan.cliente}</Text>
    <Text style={styles.profileSub}>Cliente activo</Text>
  </View>
</TouchableOpacity>
     <TouchableOpacity
  onPress={() => setMenuVisible(false)}
  activeOpacity={0.7}
>
  <View style={styles.semanaChip}>
    <Text style={styles.semanaChipText}>
      Sem {plan.semana_actual}/{plan.semana_fin}
    </Text>
  </View>
</TouchableOpacity>
            </View>

            {/* Opciones */}
            <View style={styles.menuDivider} />

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                navigation.navigate('EditarPerfil');
              }}
            >
              <View style={[styles.menuDot, { backgroundColor:'#3B82F6' }]} />
              <Text style={styles.menuItemBlue}>Editar perfil</Text>
              <Text style={styles.menuItemArrow}>›</Text>
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleLogout}
            >
              <View style={[styles.menuDot, { backgroundColor:'#EF4444' }]} />
              <Text style={styles.menuItemRed}>Cerrar sesión</Text>
              <Text style={styles.menuItemArrowRed}>›</Text>
            </TouchableOpacity>

          </View>
        )}

        <Text style={styles.fecha}>{fechaHoy()}</Text>

        {/* ── Tarjeta sesión ── */}
        {diaPendiente ? (
          <TouchableOpacity
            style={[styles.cardSesion, styles.cardSesionPending]}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Plan')}
          >
            <View style={styles.cardSesionTop}>
              <Text style={[styles.cardSesionLabel, { color:'#3B82F6' }]}>
                PRÓXIMA SESIÓN
              </Text>
              <View style={[styles.cardSesionDia, { backgroundColor:'#3B82F6' }]}>
                <Text style={styles.cardSesionDiaText}>
                  Día {diaPendiente.dia}
                </Text>
              </View>
            </View>
            <Text style={styles.cardSesionNombre}>{diaPendiente.nombre}</Text>
            <Text style={styles.cardSesionFecha}>{diaPendiente.fecha}</Text>
            <View style={[styles.cardSesionBtn, { backgroundColor:'#3B82F6' }]}>
              <Text style={styles.cardSesionBtnText}>
                ▶  Empezar entrenamiento
              </Text>
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.cardSesion, styles.cardSesionDone]}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Plan')}
          >
            <View style={styles.cardSesionTop}>
              <Text style={[styles.cardSesionLabel, { color:'#22C55E' }]}>
                SEMANA COMPLETADA
              </Text>
              <View style={[styles.cardSesionDia, { backgroundColor:'#22C55E' }]}>
                <Text style={styles.cardSesionDiaText}>✓ 7/7</Text>
              </View>
            </View>
            <Text style={styles.cardSesionNombre}>¡Excelente semana!</Text>
            <Text style={styles.cardSesionFecha}>
              Todos los días completados
            </Text>
            <View style={[styles.cardSesionBtn, { backgroundColor:'#16A34A' }]}>
              <Text style={styles.cardSesionBtnText}>Ver resumen</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* ── Progreso semana ── */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>Esta semana</Text>
            <Text style={styles.cardSub}>{diasCompletados}/7 días</Text>
          </View>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width:`${progreso * 100}%` }]} />
          </View>
          <View style={styles.miniDias}>
            {plan.dias.map(d => (
              <View
                key={d.dia}
                style={[
                  styles.miniDia,
                  d.status === 'done'    && styles.miniDiaDone,
                  d.status === 'pending' && styles.miniDiaPending,
                ]}
              >
                <Text style={styles.miniDiaText}>{d.dia}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Accesos rápidos ── */}
        <Text style={styles.seccionTitle}>Accesos rápidos</Text>
        <View style={styles.gridAccesos}>
          <TouchableOpacity
            style={styles.accesoCard}
            onPress={() => navigation.navigate('Semanas')}
          >
            <Text style={styles.accesoIcon}>📅</Text>
            <Text style={styles.accesoLabel}>Mis semanas</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.accesoCard, styles.accesoDisabled]}>
            <Text style={styles.accesoIcon}>💬</Text>
            <Text style={styles.accesoLabel}>Mensajes</Text>
            <Text style={styles.accesoPronto}>Próximamente</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.accesoCard, styles.accesoDisabled]}>
            <Text style={styles.accesoIcon}>📸</Text>
            <Text style={styles.accesoLabel}>Fotos</Text>
            <Text style={styles.accesoPronto}>Próximamente</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

function fechaHoy() {
  const d = new Date();
  return d.toLocaleDateString('es-MX', {
    weekday:'long', day:'numeric', month:'long',
  });
}

const styles = StyleSheet.create({
  container:         { flex:1, backgroundColor:'#0F172A' },
  center:            { flex:1, backgroundColor:'#0F172A',
                       justifyContent:'center', alignItems:'center' },
  errorText:         { color:'#94A3B8', fontSize:16 },

  // ── Header ──
  header:            { flexDirection:'row', justifyContent:'space-between',
                       alignItems:'center', paddingHorizontal:20,
                       paddingTop:16, paddingBottom:4 },
  profileRow:        { flexDirection:'row', alignItems:'center', gap:10 },
  avatar:            { width:38, height:38, borderRadius:19,
                       backgroundColor:'#1E3A5F', borderWidth:1.5,
                       borderColor:'#3B82F6', justifyContent:'center',
                       alignItems:'center' },
  avatarText:        { color:'#3B82F6', fontSize:13, fontWeight:'700' },
  profileName:       { color:'#F8FAFC', fontSize:14, fontWeight:'700' },
  profileSub:        { color:'#475569', fontSize:11, marginTop:1 },
  chevron:           { color:'#475569', fontSize:18, marginLeft:4,
                       transform:[{ rotate:'90deg' }] },
  semanaChip:        { backgroundColor:'#1E3A5F', borderRadius:99,
                       paddingHorizontal:10, paddingVertical:4,
                       borderWidth:1, borderColor:'#3B82F6' },
  semanaChipText:    { color:'#3B82F6', fontSize:11, fontWeight:'700' },
  fecha:             { color:'#475569', fontSize:12, paddingHorizontal:20,
                       marginTop:6, marginBottom:4,
                       textTransform:'capitalize' },

  // ── Menú ──
  menuWrap:          { backgroundColor:'#1E293B',
                       borderBottomLeftRadius:12,
                       borderBottomRightRadius:12,
                       borderWidth:1, borderColor:'#263040',
                       borderTopWidth:0, marginBottom:6 },
  menuTopRow:        { flexDirection:'row', alignItems:'center',
                       justifyContent:'space-between',
                       paddingHorizontal:16, paddingVertical:14 },
  menuUserRow:       { flexDirection:'row', alignItems:'center', gap:10 },
  
   menuDivider:       { height:1, backgroundColor:'#263040',
                       marginHorizontal:16 },
  menuItem:          { flexDirection:'row', alignItems:'center',
                       gap:10, paddingHorizontal:16, paddingVertical:11 },
  menuDot:           { width:6, height:6, borderRadius:3 },
  menuItemBlue:      { flex:1, color:'#93C5FD',
                       fontSize:13, fontWeight:'600' },
  menuItemRed:       { flex:1, color:'#F87171',
                       fontSize:13, fontWeight:'600' },
  menuItemArrow:     { color:'#334155', fontSize:16 },
  menuItemArrowRed:  { color:'#7F1D1D', fontSize:16 },

  // ── Tarjeta sesión ──
  cardSesion:        { borderRadius:18, padding:20,
                       marginHorizontal:16, marginTop:12, borderWidth:1 },
  cardSesionPending: { backgroundColor:'#1E3A5F', borderColor:'#3B82F6' },
  cardSesionDone:    { backgroundColor:'#14532D', borderColor:'#22C55E' },
  cardSesionTop:     { flexDirection:'row', justifyContent:'space-between',
                       alignItems:'center', marginBottom:10 },
  cardSesionLabel:   { fontSize:11, fontWeight:'700', letterSpacing:1 },
  cardSesionDia:     { borderRadius:8, paddingHorizontal:10, paddingVertical:3 },
  cardSesionDiaText: { color:'white', fontSize:12, fontWeight:'700' },
  cardSesionNombre:  { color:'#F1F5F9', fontSize:20,
                       fontWeight:'bold', marginBottom:4 },
  cardSesionFecha:   { color:'#64748B', fontSize:13, marginBottom:16 },
  cardSesionBtn:     { borderRadius:12, paddingVertical:13,
                       alignItems:'center' },
  cardSesionBtnText: { color:'white', fontSize:15, fontWeight:'700' },

  // ── Progreso ──
  card:              { backgroundColor:'#1E293B', borderRadius:18,
                       padding:16, marginHorizontal:16, marginTop:12 },
  cardHeaderRow:     { flexDirection:'row', justifyContent:'space-between',
                       alignItems:'center', marginBottom:10 },
  cardTitle:         { color:'#F1F5F9', fontSize:15, fontWeight:'700' },
  cardSub:           { color:'#64748B', fontSize:13 },
  progressBar:       { height:6, backgroundColor:'#0F172A',
                       borderRadius:99, overflow:'hidden', marginBottom:12 },
  progressFill:      { height:6, backgroundColor:'#3B82F6', borderRadius:99 },
  miniDias:          { flexDirection:'row', justifyContent:'space-between',
                       gap:4 },
  miniDia:           { flex:1, aspectRatio:1, borderRadius:8,
                       backgroundColor:'#0F172A', justifyContent:'center',
                       alignItems:'center' },
  miniDiaDone:       { backgroundColor:'#166534' },
  miniDiaPending:    { backgroundColor:'#1E3A5F',
                       borderWidth:1, borderColor:'#3B82F6' },
  miniDiaText:       { color:'#64748B', fontSize:12, fontWeight:'600' },

  // ── Accesos rápidos ──
  seccionTitle:      { color:'#94A3B8', fontSize:13, fontWeight:'700',
                       letterSpacing:0.5, marginHorizontal:20,
                       marginTop:20, marginBottom:10,
                       textTransform:'uppercase' },
  gridAccesos:       { flexDirection:'row', flexWrap:'wrap',
                       paddingHorizontal:12, gap:10, paddingBottom:30 },
  accesoCard:        { width:'47%', backgroundColor:'#1E293B',
                       borderRadius:14, padding:16,
                       alignItems:'center', gap:6 },
  accesoDisabled:    { opacity:0.5 },
  accesoIcon:        { fontSize:28 },
  accesoLabel:       { color:'#F1F5F9', fontSize:14, fontWeight:'600' },
  accesoPronto:      { color:'#475569', fontSize:11 },
});