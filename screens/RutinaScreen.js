import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, Modal, StyleSheet,
  Image, TouchableOpacity, ActivityIndicator,
  Dimensions, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useVideoPlayer, VideoView } from 'expo-video';

import { API_URL } from '../config';
const { width: SW, height: SH } = Dimensions.get('window');

const TIPO_ETIQUETA = {
  MONOSERIE: { label: 'LINEAL',   bg: '#dbeafe', text: '#1d4ed8' },
  BISERIE:   { label: 'BISERIE',  bg: '#d1fae5', text: '#065f46' },
  TRISERIE:  { label: 'TRISERIE', bg: '#fef3c7', text: '#92400e' },
  CIRCUITO:  { label: 'CIRCUITO', bg: '#fce7f3', text: '#9d174d' },
};
const METODO_LABEL = {
  normal:    'Normal',
  restpause: 'Rest-pause',
  '888':     'Descend.',
  '21s':     '3 Rangos',
  '10_21':   '10+21s',
  isometria: 'Isometría',
  forzadas:  'Forzadas',
  parciales: 'Parciales',
  negativas: 'Negativas',
};
const EJ_BG = ['#ffffff', '#f8f9fb', '#f4f6f9', '#f0f3f7'];

const NIVEL_CONFIANZA_LABEL = { A: 'alta', B: 'media', C: 'baja' };

// ── Conversión de unidades (mismo factor que Calculador1RM en el backend) ──
const KG_POR_LB = 0.45359237;
const LB_POR_KG = 2.20462262;

/**
 * Convierte un valor numérico de una unidad a otra, redondeando al
 * incremento realista de carga (2.5 en kg, 5 en lb) — igual que hace
 * el backend en Calculador1RM::redondear(). Si no hay valor numérico
 * válido o las unidades son iguales, devuelve el valor tal cual.
 */
function convertirPeso(valor, deUnidad, aUnidad) {
  const v = parseFloat(valor);
  if (!v || !isFinite(v) || deUnidad === aUnidad) return valor;
  const factor = deUnidad === 'kg' ? LB_POR_KG : KG_POR_LB;
  const convertido = v * factor;
  const paso = aUnidad === 'lb' ? 5 : 2.5;
  return String(Math.round(convertido / paso) * paso);
}

/**
 * Cambia la unidad (kg↔lb) de un campo de peso, convirtiendo el
 * número para que siga representando el mismo peso físico.
 *
 * Si el estado actual es 'sugerido' (el cliente todavía no confirmó
 * esa serie), el peso que se ve viene del campo *_sugerido, no del
 * campo real — así que hay que convertir y guardar ahí, y actualizar
 * 'peso_sugerido_unidad' (que es lo que resolverEstadoPeso() usa para
 * decidir en qué unidad mostrar la sugerencia). Si además el campo
 * real ya tenía algo puesto (aunque no se esté mostrando porque no es
 * 'confirmado'), también se sincroniza para no dejar datos inconsistentes.
 *
 * Si el estado es 'vacio' o 'confirmado', se convierte directamente
 * el campo real de peso.
 */
function toggleUnidadPeso({
  onChange, pesoKey, unidadKey, sugeridoKey,
  estadoActual, valorActual, unidadActual,
}) {
  const nuevaUnidad = unidadActual === 'kg' ? 'lb' : 'kg';

  if (estadoActual === 'sugerido' && sugeridoKey) {
    const nuevoValor = convertirPeso(valorActual, unidadActual, nuevaUnidad);
    onChange(sugeridoKey, nuevoValor);
    onChange('peso_sugerido_unidad', nuevaUnidad);
    onChange(unidadKey, nuevaUnidad);
    return;
  }

  const nuevoValor = convertirPeso(valorActual, unidadActual, nuevaUnidad);
  onChange(pesoKey, nuevoValor);
  onChange(unidadKey, nuevaUnidad);
}

/**
 * Determina si una serie ya tiene lo necesario para poder marcarse
 * como "Listo". Cuenta como completa tanto un peso puesto por el
 * cliente/entrenador como un peso SUGERIDO por el sistema (calculado
 * a partir del 1RM) — así el cliente no está obligado a confirmar
 * manualmente el peso si ya hay una sugerencia disponible.
 *
 * Los métodos sin sugerencia automática (21s, isometría, parciales,
 * negativas) siguen exigiendo que el peso esté puesto explícitamente.
 */
function serieCompleta(serie) {
  const m = serie.metodo ?? 'normal';

  const tienePeso = (pesoKey, sugeridoKey) => {
    const v = serie[pesoKey];
    const explicito = v != null && v !== '' && parseFloat(v) > 0;
    return explicito || (sugeridoKey && serie[sugeridoKey] != null);
  };

  if (m === '888') {
    return tienePeso('peso1', 'peso1_sugerido')
        && tienePeso('peso2', 'peso2_sugerido')
        && tienePeso('peso3', 'peso3_sugerido');
  }
  if (m === '10_21')     return tienePeso('peso_10', 'peso_10_sugerido');
  if (m === 'restpause') return tienePeso('peso_rp', 'peso_sugerido');
  if (m === 'forzadas')  return tienePeso('peso_fz', 'peso_sugerido');
  if (m === '21s')       return !!serie.peso_21s;
  if (m === 'isometria') return !!serie.peso_iso;
  if (m === 'parciales') return !!serie.peso_pc;
  if (m === 'negativas') return !!serie.peso_ng;

  return tienePeso('peso', 'peso_sugerido');
}

/**
 * Copia el peso SUGERIDO al campo de peso real cuando el cliente no
 * puso nada manualmente. Se llama justo antes de marcar una serie
 * como completada, para que:
 *  - el registro que se guarda/envía al backend sea un peso real
 *    (no solo la sugerencia), y así se pueda usar para el 1RM.
 *  - el PesoTrigger deje de mostrar "≈" y pase a verse como
 *    confirmado, igual que si el cliente lo hubiera tocado.
 *
 * Si el cliente ya puso un peso explícito, no se toca nada. Nótese
 * que el peso_sugerido y su unidad ya vienen consistentes entre sí
 * (si el cliente togglea kg/lb antes de completar la serie, ambos se
 * actualizan juntos en toggleUnidadPeso), así que copiar unidadKey
 * desde peso_sugerido_unidad aquí es seguro.
 */
function aplicarSugeridoSiFalta(serie) {
  const copiar = (pesoKey, sugeridoKey, unidadKey) => {
    const actual = serie[pesoKey];
    const tieneActual = actual != null && actual !== '' && parseFloat(actual) > 0;
    if (!tieneActual && serie[sugeridoKey] != null) {
      serie[pesoKey] = String(serie[sugeridoKey]);
      if (serie.peso_sugerido_unidad) serie[unidadKey] = serie.peso_sugerido_unidad;
    }
  };

  const m = serie.metodo ?? 'normal';
  if (m === 'normal')         copiar('peso', 'peso_sugerido', 'unidad');
  else if (m === 'restpause') copiar('peso_rp', 'peso_sugerido', 'unidad_rp');
  else if (m === 'forzadas')  copiar('peso_fz', 'peso_sugerido', 'unidad_fz');
  else if (m === '888') {
    copiar('peso1', 'peso1_sugerido', 'unidad1');
    copiar('peso2', 'peso2_sugerido', 'unidad2');
    copiar('peso3', 'peso3_sugerido', 'unidad3');
  } else if (m === '10_21') {
    copiar('peso_10', 'peso_10_sugerido', 'unidad_10');
    copiar('peso_21', 'peso_21_sugerido', 'unidad_21');
  }
  return serie;
}

// Formatea segundos totales -> "1m 30s" / "45s" / "2m" / null si no hay valor
function formatearDescanso(segTotal) {
  const total = parseInt(segTotal) || 0;
  if (total === 0) return null;
  const m = Math.floor(total / 60), s = total % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}

function cloneBloques(bloques) {
  return bloques.map(b => ({
    ...b,
    ejercicios: b.ejercicios.map(e => ({
      ...e,
      series: e.series.map(s => ({ ...s })),
    })),
  }));
}

function generarOpciones(unidad) {
  const opts = [{ label: '– sin peso –', value: '' }];
  if (unidad === 'lb') {
    for (let p = 5;   p <= 500;  p += 5)  opts.push({ label: `${p} lb`, value: String(p) });
    for (let p = 510; p <= 2000; p += 10) opts.push({ label: `${p} lb`, value: String(p) });
  } else {
    for (let p = 2.5; p <= 250; p = Math.round((p + 2.5) * 10) / 10)
      opts.push({ label: `${p} kg`, value: String(p) });
    for (let p = 255; p <= 1000; p += 5)
      opts.push({ label: `${p} kg`, value: String(p) });
  }
  return opts;
}

/* ─────────────────────────────────────────
   MODAL IMAGEN FULLSCREEN
───────────────────────────────────────── */
function ImagenModal({ visible, uri, nombre, video, onClose, onVerVideo }) {
  if (!uri) return null;
  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={im.overlay}>
        <Image source={{ uri }} style={im.imagen} resizeMode="contain" />
        {(!!nombre || !!video) && (
          <View style={im.bottomBar}>
            {!!nombre && (
              <Text style={im.nombreText} numberOfLines={2}>{nombre}</Text>
            )}
            {!!video && (
              <TouchableOpacity style={im.videoBtn} onPress={onVerVideo} activeOpacity={0.85}>
                <View style={im.videoBtnCirculo}>
                  <Text style={im.videoBtnIcono}>▶</Text>
                </View>
                <Text style={im.videoBtnTexto}>Ver video</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        <TouchableOpacity style={im.cerrarBtn} onPress={onClose} activeOpacity={0.8}>
          <Text style={im.cerrarTxt}>✕</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const im = StyleSheet.create({
  overlay:    { flex:1, backgroundColor:'#000', alignItems:'center', justifyContent:'center' },
  imagen:     { width:SW, height:SH },
  bottomBar:  { position:'absolute', left:0, right:0, bottom:0,
                paddingTop:22, paddingBottom:46, paddingHorizontal:28,
                backgroundColor:'rgba(0,0,0,0.55)',
                alignItems:'center' },
  nombreText: { fontSize:16, fontWeight:'700', color:'white', textAlign:'center',
                textShadowColor:'rgba(0,0,0,0.9)', textShadowOffset:{width:0,height:1}, textShadowRadius:6 },
  cerrarBtn:  { position:'absolute', top:52, right:20, width:36, height:36, borderRadius:18,
                backgroundColor:'rgba(255,255,255,0.15)', borderWidth:1,
                borderColor:'rgba(255,255,255,0.3)', alignItems:'center', justifyContent:'center' },
  cerrarTxt:  { color:'white', fontSize:16, fontWeight:'700' },
  videoBtn:       { marginTop:14, flexDirection:'row',
                    alignItems:'center', gap:8, backgroundColor:'rgba(255,255,255,0.14)',
                    borderWidth:1, borderColor:'rgba(255,255,255,0.35)', borderRadius:99,
                    paddingVertical:9, paddingHorizontal:18 },
  videoBtnCirculo:{ width:22, height:22, borderRadius:11, backgroundColor:'#fff',
                    alignItems:'center', justifyContent:'center' },
  videoBtnIcono:  { fontSize:9, color:'#111827', marginLeft:1 },
  videoBtnTexto:  { color:'#fff', fontSize:13, fontWeight:'700' },
});

/* ─────────────────────────────────────────
   COMPONENTE PRINCIPAL
───────────────────────────────────────── */
export default function RutinaScreen({ route }) {
  const { clienteId, semana, dia } = route.params;

  const [sesion, setSesion]       = useState(null);
  const [data, setData]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved | error

  const [selectorVisible, setSelectorVisible] = useState(false);
  const [selectorVal, setSelectorVal]         = useState('');
  const [selectorCb, setSelectorCb]           = useState(null);
  const [selectorTitulo, setSelectorTitulo]   = useState('');

  const [videoVisible, setVideoVisible] = useState(false);
  const [videoUrl, setVideoUrl]         = useState('');
  const [videoTitulo, setVideoTitulo]   = useState('');

  const [imgModal, setImgModal] = useState({ visible:false, uri:'', nombre:'', video:'' });

  const mainScrollRef = useRef(null);
  const bloqueRefs    = useRef({});
  const saveTimer     = useRef(null);

  function abrirImagen(uri, nombre, video) { setImgModal({ visible:true, uri, nombre, video: video ?? '' }); }
  function cerrarImagen() { setImgModal(prev => ({ ...prev, visible:false })); }
  function abrirVideo(url, nombre) { setVideoUrl(url ?? ''); setVideoTitulo(nombre ?? ''); setVideoVisible(true); }
  function abrirSelector(opciones, valorActual, titulo, callback) {
    setSelectorVal(valorActual != null ? String(valorActual) : '');
    setSelectorTitulo(titulo);
    setSelectorCb(() => callback);
    setSelectorVisible(true);
  }
  function cerrarSelector() { setSelectorVisible(false); }

  // Limpia lo que el cliente escribe: solo dígitos y un punto decimal
  // (acepta coma como separador decimal y la convierte a punto).
  function cambiarSelectorVal(texto) {
    let limpio = texto.replace(',', '.').replace(/[^0-9.]/g, '');
    const partes = limpio.split('.');
    if (partes.length > 2) limpio = partes[0] + '.' + partes.slice(1).join('');
    setSelectorVal(limpio);
  }

  function confirmarPesoManual() {
    const valor = (selectorVal ?? '').trim();
    if (selectorCb) selectorCb(valor);
    setSelectorVisible(false);
  }

  function limpiarPesoManual() {
    if (selectorCb) selectorCb('');
    setSelectorVisible(false);
  }

  useEffect(() => {
    fetch(`${API_URL}/rutina/${clienteId}/${semana}/${dia}`)
      .then(r => { if (!r.ok) throw new Error(`Error ${r.status}`); return r.json(); })
      .then(json => { setSesion(json); setData(cloneBloques(json.bloques ?? [])); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [clienteId, semana, dia]);

  // ── Autosave ──
  const guardarSilencioso = useCallback(async (dataActual) => {
    setSaveStatus('saving');
    try {
      const res = await fetch(
        `${API_URL}/rutina/${clienteId}/${semana}/${dia}/pesos/`,
        { method:'PATCH', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ bloques: dataActual }) }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (e) {
      console.log('Autosave error:', e.message);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }
  }, [clienteId, semana, dia]);

  function setCampo(bi, ei, si, key, value) {
    setData(prev => {
      const next = cloneBloques(prev);
      next[bi].ejercicios[ei].series[si][key] = value;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => guardarSilencioso(next), 1500);
      return next;
    });
  }

  // Al completar una serie: si algún ejercicio del bloque no tiene
  // peso propio pero sí tiene un peso sugerido, se usa la sugerencia
  // como registro real — así el cliente no necesita confirmar el
  // peso a mano cuando ya hay una sugerencia disponible.
  function completarBloquesSerie(bi, si) {
    setData(prev => {
      const next = cloneBloques(prev);
      next[bi].ejercicios.forEach((_, ei) => {
        const serie = next[bi].ejercicios[ei].series[si];
        aplicarSugeridoSiFalta(serie);
        serie.completada = true;
      });
      // Autosave inmediato al completar serie
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => guardarSilencioso(next), 500);
      return next;
    });
  }

  function scrollAlSiguienteBloque(bi) {
    const ref = bloqueRefs.current[bi + 1];
    if (!ref || !mainScrollRef.current) return;
    ref.measureLayout(
      mainScrollRef.current,
      (x, y) => { mainScrollRef.current.scrollTo({ y: y - 12, animated:true }); },
      () => {}
    );
  }

  function bloqueSerieCompletada(bi, si) {
    const bloque = data[bi];
    if (!bloque) return false;
    return bloque.ejercicios.every(ej => {
      const serie = ej.series[si];
      return serie && serieCompleta(serie);
    });
  }

  function bloqueSerieYaHecha(bi, si) {
    const bloque = data[bi];
    if (!bloque) return false;
    return bloque.ejercicios.every(ej => {
      const serie = ej.series[si];
      return serie && !!serie.completada && serieCompleta(serie);
    });
  }

  // Indicador de estado del autosave
  const saveLabel = saveStatus === 'saving' ? 'Guardando...'
                  : saveStatus === 'saved'  ? '✓ Guardado'
                  : saveStatus === 'error'  ? '⚠ Error al guardar'
                  : '';
  const saveLabelColor = saveStatus === 'error' ? '#ef4444'
                       : saveStatus === 'saved' ? '#22c55e'
                       : '#9ca3af';

  if (loading) return (
    <View style={s.center}>
      <ActivityIndicator size="large" color="#2563eb" />
      <Text style={s.loadingText}>Cargando rutina...</Text>
    </View>
  );
  if (error) return (
    <View style={s.center}>
      <Text style={s.errorText}>No se pudo cargar la rutina.</Text>
      <Text style={s.errorSub}>{error}</Text>
    </View>
  );
  if (!data.length) return (
    <View style={s.center}>
      <Text style={s.emptyText}>No tienes rutina para hoy.</Text>
    </View>
  );

  return (
    <View style={{ flex:1, backgroundColor:'#f4f5f7' }}>
      <ScrollView
        ref={mainScrollRef}
        style={s.container}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header mejorado ── */}
        <View style={s.header}>
          <Text style={s.headerSub}>Semana {semana} · Día {dia}</Text>
          <View style={s.headerRow}>
            <Text style={s.headerTitle}>
              {sesion?.cliente || 'Tu rutina de hoy'}
            </Text>
            <View style={s.headerChip}>
              <Text style={s.headerChipText}>{data.length} bloques</Text>
            </View>
          </View>
          {/* Indicador autosave */}
          {!!saveLabel && (
            <Text style={[s.saveLabel, { color: saveLabelColor }]}>
              {saveLabel}
            </Text>
          )}
        </View>

        {!!sesion?.nota_sesion && (
          <View style={s.notaSesionCard}>
            <Text style={s.notaSesionLabel}>Nota de la sesión</Text>
            <Text style={s.notaSesionText}>{sesion.nota_sesion}</Text>
          </View>
        )}

        {data.map((bloque, bi) => (
          <View key={bi} ref={ref => { bloqueRefs.current[bi] = ref; }}>
            <BloqueCard
              bloque={bloque}
              bloqueIdx={bi}
              setCampo={setCampo}
              abrirSelector={abrirSelector}
              abrirVideo={abrirVideo}
              abrirImagen={abrirImagen}
              bloqueSerieCompletada={(si) => bloqueSerieCompletada(bi, si)}
              bloqueSerieYaHecha={(si) => bloqueSerieYaHecha(bi, si)}
              onCompletarSerie={(si) => {
                completarBloquesSerie(bi, si);
                const numSeries = bloque.ejercicios[0]?.series?.length ?? 0;
                if (si === numSeries - 1)
                  setTimeout(() => scrollAlSiguienteBloque(bi), 300);
              }}
            />
          </View>
        ))}

        <View style={{ height: 40 }} />
      </ScrollView>

      <ImagenModal
        visible={imgModal.visible}
        uri={imgModal.uri}
        nombre={imgModal.nombre}
        video={imgModal.video}
        onClose={cerrarImagen}
        onVerVideo={() => {
          cerrarImagen();
          abrirVideo(imgModal.video, imgModal.nombre);
        }}
      />

      <Modal visible={selectorVisible} transparent animationType="slide" onRequestClose={cerrarSelector}>
        <KeyboardAvoidingView
          style={s.modalWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          <TouchableOpacity style={s.modalFondo} activeOpacity={1} onPress={cerrarSelector} />
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>{selectorTitulo}</Text>
            <View style={s.pesoInputWrap}>
              <TextInput
                style={s.pesoInput}
                value={selectorVal}
                onChangeText={cambiarSelectorVal}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor="#d1d5db"
                autoFocus
                selectTextOnFocus
                onSubmitEditing={confirmarPesoManual}
              />
            </View>
            <View style={s.pesoInputBtnRow}>
              <TouchableOpacity style={s.pesoInputBtnLimpiar} onPress={limpiarPesoManual} activeOpacity={0.75}>
                <Text style={s.pesoInputBtnLimpiarTxt}>Sin peso</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.pesoInputBtnConfirmar} onPress={confirmarPesoManual} activeOpacity={0.85}>
                <Text style={s.pesoInputBtnConfirmarTxt}>Confirmar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <VideoModal
        visible={videoVisible}
        url={videoUrl}
        titulo={videoTitulo}
        onClose={() => setVideoVisible(false)}
      />
    </View>
  );
}

/* ─────────────────────────────────────────
   BLOQUE CARD
───────────────────────────────────────── */
function BloqueCard({ bloque, bloqueIdx, setCampo, abrirSelector, abrirVideo,
  abrirImagen, bloqueSerieCompletada, bloqueSerieYaHecha, onCompletarSerie }) {

  const tipo      = TIPO_ETIQUETA[bloque.tipo] ?? TIPO_ETIQUETA.MONOSERIE;
  const numSeries = bloque.ejercicios[0]?.series?.length ?? 0;
  const descansosSerie = bloque.descansos_serie ?? [];
  const scrollsRef = useRef({});

  function scrollTodos(si) {
    Object.values(scrollsRef.current).forEach(ref => {
      ref?.scrollTo({ x: (si + 1) * 131, animated:true });
    });
  }

  const siPendiente = Array.from({ length: numSeries }).findIndex((_, si) =>
    bloqueSerieCompletada(si) && !bloqueSerieYaHecha(si)
  );
  const siUltimaHecha = Array.from({ length: numSeries })
    .map((_, si) => bloqueSerieYaHecha(si) ? si : -1)
    .filter(x => x >= 0).at(-1) ?? -1;
  const siActivo = siPendiente >= 0 ? siPendiente : siUltimaHecha;

  return (
    <View style={s.bloque}>
      <View style={s.bloqueHeader}>
        <View style={[s.bloqueTag, { backgroundColor: tipo.bg }]}>
          <Text style={[s.bloqueTagText, { color: tipo.text }]}>{tipo.label}</Text>
        </View>
        <Text style={s.bloqueNombre}>
          {bloque.ejercicios.length === 1
            ? bloque.ejercicios[0].nombre
            : `${bloque.ejercicios.length} ejercicios`}
        </Text>
      </View>

      <View style={s.seriesHeaderRow}>
        <View style={s.colInfoHeader}>
          <Text style={s.colInfoHeaderText}>Ejercicio</Text>
        </View>
      </View>

      {bloque.ejercicios.map((ej, ei) => (
        <EjercicioRow
          key={ei}
          ej={ej}
          ejIdx={ei}
          bloqueIdx={bloqueIdx}
          isLast={ei === bloque.ejercicios.length - 1}
          setCampo={setCampo}
          abrirSelector={abrirSelector}
          abrirVideo={abrirVideo}
          abrirImagen={abrirImagen}
          scrollsRef={scrollsRef}
          serieHecha={(si) => bloqueSerieYaHecha(si)}
          descansosSerie={descansosSerie}
        />
      ))}

      <View style={s.botonesSerieRow}>
        {siActivo >= 0 && (() => {
          const done = bloqueSerieYaHecha(siActivo);
          return (
            <TouchableOpacity
              style={[s.btnSerie, done && s.btnSerieDone]}
              onPress={() => {
                if (!done) {
                  onCompletarSerie(siActivo);
                  setTimeout(() => scrollTodos(siActivo), 150);
                }
              }}
              activeOpacity={done ? 1 : 0.75}
            >
              <Text style={[s.btnSerieTxt, done && s.btnSerieTxtDone]}>
                {done ? `✓ S${siActivo + 1}` : `Listo S${siActivo + 1}`}
              </Text>
            </TouchableOpacity>
          );
        })()}
      </View>
    </View>
  );
}

/* ─────────────────────────────────────────
   EJERCICIO ROW
───────────────────────────────────────── */
function EjercicioRow({ ej, ejIdx, bloqueIdx, isLast, setCampo, abrirSelector,
  abrirVideo, abrirImagen, scrollsRef, serieHecha, descansosSerie }) {

  const scrollRef = useRef(null);

  React.useEffect(() => {
    if (scrollsRef) scrollsRef.current[ejIdx] = scrollRef.current;
  });

  return (
    <View style={[
      s.ejercicioRow,
      { backgroundColor: EJ_BG[ejIdx % EJ_BG.length] ?? '#fff' },
      !isLast && s.ejercicioRowBorder,
    ]}>
      <TouchableOpacity
        style={s.colImg}
        onPress={() => ej.imagen && abrirImagen(ej.imagen, ej.nombre, ej.video)}
        activeOpacity={ej.imagen ? 0.8 : 1}
        disabled={!ej.imagen}
      >
        {ej.imagen
          ? <Image source={{ uri: ej.imagen }} style={s.ejImgSmall} resizeMode="cover" />
          : <View style={s.ejImgPlaceholder}>
              <Text style={s.ejImgPlaceholderText}>?</Text>
            </View>
        }
        {ej.video && (
          <TouchableOpacity
            style={s.videoPlayCircleWrap}
            onPress={() => abrirVideo(ej.video, ej.nombre)}
            activeOpacity={0.75}
            hitSlop={{ top:8, bottom:8, left:8, right:8 }}
          >
            <View style={s.videoPlayCircle}>
              <Text style={s.videoPlayIcon}>▶</Text>
            </View>
          </TouchableOpacity>
        )}
      </TouchableOpacity>

      <View style={s.colDerecha}>
        {/* ── Nombre mejorado ── */}
        <View style={s.ejNombreWrap}>
          <Text style={s.ejNombre} numberOfLines={2}>{ej.nombre}</Text>
          {ej.series[0]?.metodo && ej.series[0].metodo !== 'normal' && (
            <View style={s.ejMetodoBadge}>
              <Text style={s.ejMetodoBadgeText}>
                {METODO_LABEL[ej.series[0].metodo] ?? ej.series[0].metodo}
              </Text>
            </View>
          )}
        </View>

        {!!ej.nota_ej && (
          <View style={s.notaEjWrap}>
            <Text style={s.notaEjText}>{ej.nota_ej}</Text>
          </View>
        )}

        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.colSeriesScrollContent}
        >
          {ej.series.map((serie, si) => (
            <SerieCol
              key={si}
              serie={serie}
              serieIdx={si}
              isLast={si === ej.series.length - 1}
              onChange={(key, val) => setCampo(bloqueIdx, ejIdx, si, key, val)}
              abrirSelector={abrirSelector}
              done={serieHecha(si)}
              descanso={descansosSerie?.[si]?.valor}
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

/* ─────────────────────────────────────────
   SERIE COL
───────────────────────────────────────── */
function SerieCol({ serie, serieIdx, isLast, onChange, abrirSelector, done, descanso }) {
  const m = serie.metodo ?? 'normal';
  const tempoActivo = serie.tempo_activo === '1' || serie.tempo_activo === true;
  const tE = serie.tempo_excentrica  ?? '0';
  const tP = serie.tempo_pausa       ?? '0';
  const tC = serie.tempo_concentrica ?? '0';
  const hayTempo = tempoActivo && (tE !== '0' || tP !== '0' || tC !== '0');
  const rirActivo = serie.rir_activo === '1' || serie.rir_activo === true;
  const rirModo   = (serie.rir_modo ?? 'rir').toUpperCase();
  const rirVal    = serie.rir_valor ?? '';
  const hayRir    = rirActivo && !!rirVal;
  const descansoTxt = formatearDescanso(descanso);

  return (
    <View style={[s.serieCol, done && s.serieColDone, !isLast && { marginRight:5 }]}>
      <View style={s.metodoTag}>
        <Text style={s.metodoTagText}>{METODO_LABEL[m] ?? m}</Text>
      </View>
      <Text style={s.serieNum}>S{serieIdx + 1}</Text>

      {m === 'normal'    && <CamposNormal    serie={serie} onChange={onChange} abrirSelector={abrirSelector} done={done} />}
      {m === 'restpause' && <CamposRestpause serie={serie} onChange={onChange} abrirSelector={abrirSelector} done={done} />}
      {m === '888'       && <Campos888       serie={serie} onChange={onChange} abrirSelector={abrirSelector} done={done} />}
      {m === '21s'       && <Campos21s       serie={serie} onChange={onChange} abrirSelector={abrirSelector} done={done} />}
      {m === '10_21'     && <Campos10_21     serie={serie} onChange={onChange} abrirSelector={abrirSelector} done={done} />}
      {m === 'isometria' && <CamposIsometria serie={serie} onChange={onChange} abrirSelector={abrirSelector} done={done} />}
      {m === 'forzadas'  && <CamposForzadas  serie={serie} onChange={onChange} abrirSelector={abrirSelector} done={done} />}
      {(m === 'parciales' || m === 'negativas') && (
        <CamposSimple
          serie={serie} onChange={onChange} abrirSelector={abrirSelector} done={done}
          pesoKey={m === 'parciales' ? 'peso_pc' : 'peso_ng'}
        />
      )}

      {hayTempo && (
        <View style={s.tempoBadge}>
          <Text style={s.tempoLabel}>TEMPO</Text>
          <Text style={s.tempoVal}>Baj.{tE}  Pau.{tP}  Sub.{tC}</Text>
        </View>
      )}
      {hayRir && (
        <View style={s.rirBadge}>
          <Text style={s.rirText}>{rirModo} {rirVal}</Text>
        </View>
      )}
      {!!descansoTxt && (
        <View style={s.descansoSerieBadge}>
          <Text style={s.descansoSerieBadgeText}>💤 {descansoTxt}</Text>
        </View>
      )}
      {done && (
        <View style={s.checkBadge}><Text style={s.checkText}>✓</Text></View>
      )}
    </View>
  );
}

/* ─────────────────────────────────────────
   CAMPOS POR MÉTODO
───────────────────────────────────────── */

/**
 * Trigger de peso. Trabaja con tres estados:
 * - 'vacio':      no hay ningún número (ni el entrenador puso peso, ni
 *                 hay 1RM calculado todavía). Guion ámbar.
 * - 'sugerido':   hay un número, pero el CLIENTE todavía no confirmó
 *                 esa serie (no tocó "Listo"). Se ve celeste, con "≈".
 * - 'confirmado': la serie ya está marcada como hecha (completada).
 *                 Se muestra en texto normal — es el registro real
 *                 del cliente.
 */
function PesoTrigger({ estado, valor, unidad, onPress, onToggleUnidad }) {
  const esVacio    = estado === 'vacio';
  const esSugerido = estado === 'sugerido';

  const textoValor = esVacio ? '–' : (esSugerido ? `≈${valor}` : `${valor}`);

  return (
    <View style={s.pesoWrap}>
      <View style={s.pesoRow}>
        <TouchableOpacity
          style={[
            s.pesoTrigger,
            esVacio && s.pesoTriggerVacio,
            esSugerido && s.pesoTriggerSugerido,
          ]}
          onPress={onPress}
          activeOpacity={0.7}
        >
          <Text
            style={[
              s.pesoTriggerVal,
              esVacio && s.pesoTriggerValVacio,
              esSugerido && s.pesoTriggerValSugerido,
            ]}
            numberOfLines={1}
          >
            {textoValor}
          </Text>
          <Text style={s.pesoTriggerArr}>▾</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.unidadBtn} onPress={onToggleUnidad} activeOpacity={0.7}>
          <Text style={s.unidadBtnText}>{unidad ?? 'kg'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/**
 * Resuelve qué mostrar en el PesoTrigger de un campo de peso concreto.
 * Además de si la serie ya está confirmada (done) o si hay peso
 * explícito/sugerido, revisa un flag "<campo>_manual": se activa en
 * cuanto el CLIENTE confirma algo en el modal de peso (lo haya
 * cambiado o no) — desde ese momento el campo se ve como su propio
 * registro (negro, sin "≈"), sin necesidad de esperar a que toque
 * "Listo" para toda la serie.
 *
 * sugeridoKey puede ser null para métodos sin sugerencia automática
 * (21s, isometría, parciales, negativas) — en ese caso, si no hay peso
 * explícito, el campo queda 'vacio' igual que siempre.
 */
function resolverEstadoPeso(serie, done, pesoKey, unidadKey, sugeridoKey) {
  const pesoRaw = serie[pesoKey];
  const pesoExplicito = pesoRaw != null && pesoRaw !== '' && parseFloat(pesoRaw) > 0;
  const confirmadoPorCliente = !!serie[`${pesoKey}_manual`];

  if (done || confirmadoPorCliente) {
    return {
      estado: pesoExplicito ? 'confirmado' : 'vacio',
      valor: pesoRaw,
      unidad: serie[unidadKey] ?? 'kg',
    };
  }

  if (pesoExplicito) {
    return { estado: 'sugerido', valor: pesoRaw, unidad: serie[unidadKey] ?? 'kg' };
  }

  if (sugeridoKey && serie[sugeridoKey] != null) {
    return {
      estado: 'sugerido',
      valor: serie[sugeridoKey],
      unidad: serie.peso_sugerido_unidad ?? serie[unidadKey] ?? 'kg',
    };
  }

  return { estado: 'vacio', valor: null, unidad: serie[unidadKey] ?? 'kg' };
}

/**
 * Abre el selector de peso, ya posicionado en `valorInicial` (el valor
 * que se estaba mostrando en el trigger — sea el peso confirmado, el
 * que puso el entrenador, o el calculado) y en su unidad. Así,
 * confirmar lo que ya se ve es un solo toque; cambiarlo es igual de
 * fácil que siempre.
 */
function abrirPeso(abrirSelector, pesoKey, unidadKey, unidadDefault, serie, onChange, valorInicial, unidadInicial) {
  const unidadActual  = serie[unidadKey] ?? unidadDefault ?? 'kg';
  const unidadParaUsar = unidadInicial ?? unidadActual;

  const opts  = generarOpciones(unidadParaUsar);
  const valor = (valorInicial != null && valorInicial !== '') ? String(valorInicial) : '';

  abrirSelector(opts, valor, `Peso (${unidadParaUsar})`, val => {
    onChange(pesoKey, val);
    // En cuanto el cliente confirma algo en el modal (lo haya cambiado
    // o no), se considera SU registro — deja de verse como sugerencia.
    // Si borra el valor ("Sin peso"), vuelve a quedar disponible para
    // mostrar la sugerencia de nuevo.
    onChange(`${pesoKey}_manual`, val !== '');
    if (unidadParaUsar !== unidadActual) {
      onChange(unidadKey, unidadParaUsar);
    }
  });
}

function RepsRow({ label, value }) {
  return (
    <View style={s.repsRow}>
      <Text style={s.repsRowLabel}>{label}</Text>
      <Text style={s.repsRowVal}>{value ?? '–'}</Text>
    </View>
  );
}

function CamposNormal({ serie, onChange, abrirSelector, done }) {
  const est = resolverEstadoPeso(serie, done, 'peso', 'unidad', 'peso_sugerido');
  return (
    <>
      <RepsRow label="Reps" value={serie.reps} />
      <PesoTrigger
        estado={est.estado}
        valor={est.valor}
        unidad={est.unidad}
        onPress={() => abrirPeso(abrirSelector, 'peso', 'unidad', 'kg', serie, onChange, est.valor, est.unidad)}
        onToggleUnidad={() => toggleUnidadPeso({
          onChange,
          pesoKey: 'peso', unidadKey: 'unidad', sugeridoKey: 'peso_sugerido',
          estadoActual: est.estado, valorActual: est.valor, unidadActual: est.unidad,
        })} />
    </>
  );
}

function CamposRestpause({ serie, onChange, abrirSelector, done }) {
  const est = resolverEstadoPeso(serie, done, 'peso_rp', 'unidad_rp', 'peso_sugerido');
  return (
    <>
      <RepsRow label="Reps" value={serie.reps_rp ?? serie.reps} />
      <PesoTrigger
        estado={est.estado}
        valor={est.valor}
        unidad={est.unidad}
        onPress={() => abrirPeso(abrirSelector, 'peso_rp', 'unidad_rp', 'kg', serie, onChange, est.valor, est.unidad)}
        onToggleUnidad={() => toggleUnidadPeso({
          onChange,
          pesoKey: 'peso_rp', unidadKey: 'unidad_rp', sugeridoKey: 'peso_sugerido',
          estadoActual: est.estado, valorActual: est.valor, unidadActual: est.unidad,
        })} />
      <View style={s.metodoNota}>
        <Text style={s.metodoNotaText}>Fallo → {serie.descanso ?? 15}s</Text>
      </View>
    </>
  );
}

function Campos888({ serie, onChange, abrirSelector, done }) {
  const r = serie.reps_888 ?? 8;

  const est1 = resolverEstadoPeso(serie, done, 'peso1', 'unidad1', 'peso1_sugerido');
  const est2 = resolverEstadoPeso(serie, done, 'peso2', 'unidad2', 'peso2_sugerido');
  const est3 = resolverEstadoPeso(serie, done, 'peso3', 'unidad3', 'peso3_sugerido');

  // Los 3 tramos del dropset comparten el campo 'peso_sugerido_unidad'
  // que manda el backend (todos vienen del mismo 1RM). Si cada tramo
  // togglea su unidad por separado, ese campo compartido queda con la
  // unidad del ÚLTIMO tramo tocado, y los otros dos quedan mostrando
  // una etiqueta de unidad que ya no corresponde a su número (porque
  // solo se convirtió el valor del tramo que se tocó). Por eso hay
  // que togglear los tres juntos, siempre, en el mismo click.
  function toggleUnidad888() {
    const nuevaUnidad = est1.unidad === 'kg' ? 'lb' : 'kg';

    [
      { pesoKey: 'peso1', unidadKey: 'unidad1', sugeridoKey: 'peso1_sugerido', est: est1 },
      { pesoKey: 'peso2', unidadKey: 'unidad2', sugeridoKey: 'peso2_sugerido', est: est2 },
      { pesoKey: 'peso3', unidadKey: 'unidad3', sugeridoKey: 'peso3_sugerido', est: est3 },
    ].forEach(({ pesoKey, unidadKey, sugeridoKey, est }) => {
      if (est.estado === 'sugerido') {
        onChange(sugeridoKey, convertirPeso(est.valor, est.unidad, nuevaUnidad));
      } else if (est.valor != null && est.valor !== '') {
        onChange(pesoKey, convertirPeso(est.valor, est.unidad, nuevaUnidad));
      }
      onChange(unidadKey, nuevaUnidad);
    });

    onChange('peso_sugerido_unidad', nuevaUnidad);
  }

  function campoPeso(est, pesoKey, unidadKey, label) {
    return (
      <>
        <Text style={s.pesoSubLabel}>{label}</Text>
        <PesoTrigger
          estado={est.estado}
          valor={est.valor}
          unidad={est.unidad}
          onPress={() => abrirPeso(abrirSelector, pesoKey, unidadKey, 'kg', serie, onChange, est.valor, est.unidad)}
          onToggleUnidad={toggleUnidad888} />
      </>
    );
  }

  return (
    <>
      <RepsRow label="Reps" value={`${r}+${r}+${r}`} />
      {campoPeso(est1, 'peso1', 'unidad1', 'P1')}
      {campoPeso(est2, 'peso2', 'unidad2', 'P2')}
      {campoPeso(est3, 'peso3', 'unidad3', 'P3')}
    </>
  );
}

function Campos21s({ serie, onChange, abrirSelector, done }) {
  const r = serie.reps_21s ?? 7;
  const est = resolverEstadoPeso(serie, done, 'peso_21s', 'unidad_21s', null);
  return (
    <>
      <RepsRow label="Reps" value={`${r}+${r}+${r}`} />
      <PesoTrigger
        estado={est.estado}
        valor={est.valor}
        unidad={est.unidad}
        onPress={() => abrirPeso(abrirSelector, 'peso_21s', 'unidad_21s', 'kg', serie, onChange, est.valor, est.unidad)}
        onToggleUnidad={() => toggleUnidadPeso({
          onChange,
          pesoKey: 'peso_21s', unidadKey: 'unidad_21s', sugeridoKey: null,
          estadoActual: est.estado, valorActual: est.valor, unidadActual: est.unidad,
        })} />
    </>
  );
}

function Campos10_21({ serie, onChange, abrirSelector, done }) {
  function calcular40(v) {
    const p = parseFloat(v) || 0;
    return p > 0 ? String(Math.round(p * 0.6 * 2) / 2) : '';
  }

  const est10 = resolverEstadoPeso(serie, done, 'peso_10', 'unidad_10', 'peso_10_sugerido');
  const est21 = resolverEstadoPeso(serie, done, 'peso_21', 'unidad_21', 'peso_21_sugerido');

  // El campo ×21s se deriva siempre del ×10 con la regla −40%, así que
  // togglear su unidad debe togglear la del ×10 (que arrastra al ×21s
  // recalculado), no tratarlo como un campo independiente.
  function toggleUnidad10y21() {
    const nuevaUnidad = est10.unidad === 'kg' ? 'lb' : 'kg';

    if (est10.estado === 'sugerido') {
      const nuevoValor10 = convertirPeso(est10.valor, est10.unidad, nuevaUnidad);
      const nuevoValor21 = convertirPeso(est21.valor, est21.unidad, nuevaUnidad);
      onChange('peso_10_sugerido', nuevoValor10);
      onChange('peso_21_sugerido', nuevoValor21);
      onChange('peso_sugerido_unidad', nuevaUnidad);
      onChange('unidad_10', nuevaUnidad);
      onChange('unidad_21', nuevaUnidad);
      return;
    }

    const nuevoValor10 = convertirPeso(est10.valor, est10.unidad, nuevaUnidad);
    onChange('peso_10', nuevoValor10);
    onChange('peso_21', calcular40(nuevoValor10));
    onChange('unidad_10', nuevaUnidad);
    onChange('unidad_21', nuevaUnidad);
  }

  return (
    <>
      <Text style={s.pesoSubLabel}>×10</Text>
      <PesoTrigger
        estado={est10.estado}
        valor={est10.valor}
        unidad={est10.unidad}
        onPress={() => {
          const opts = generarOpciones(est10.unidad);
          const valorInicial = est10.valor != null ? String(est10.valor) : '';
          abrirSelector(opts, valorInicial, `Peso ×10 (${est10.unidad})`, v => {
            onChange('peso_10', v);
            onChange('peso_10_manual', v !== '');
            onChange('peso_21', calcular40(v));
            onChange('peso_21_manual', v !== ''); // se autocalculó a partir de lo que el cliente puso
            if (est10.unidad !== (serie.unidad_10 ?? 'kg')) {
              onChange('unidad_10', est10.unidad);
              onChange('unidad_21', est10.unidad);
            }
          });
        }}
        onToggleUnidad={toggleUnidad10y21} />
      <Text style={s.pesoSubLabel}>×21s</Text>
      <PesoTrigger
        estado={est21.estado}
        valor={est21.valor}
        unidad={est21.unidad}
        onPress={() => abrirPeso(abrirSelector, 'peso_21', 'unidad_21', 'kg', serie, onChange, est21.valor, est21.unidad)}
        onToggleUnidad={toggleUnidad10y21} />
      <View style={s.metodoNota}><Text style={s.metodoNotaText}>−40%→21s</Text></View>
    </>
  );
}

function CamposIsometria({ serie, onChange, abrirSelector, done }) {
  const est = resolverEstadoPeso(serie, done, 'peso_iso', 'unidad_iso', null);
  return (
    <>
      <PesoTrigger
        estado={est.estado}
        valor={est.valor}
        unidad={est.unidad}
        onPress={() => abrirPeso(abrirSelector, 'peso_iso', 'unidad_iso', 'kg', serie, onChange, est.valor, est.unidad)}
        onToggleUnidad={() => toggleUnidadPeso({
          onChange,
          pesoKey: 'peso_iso', unidadKey: 'unidad_iso', sugeridoKey: null,
          estadoActual: est.estado, valorActual: est.valor, unidadActual: est.unidad,
        })} />
      <RepsRow label="R/brazo" value={serie.reps_brazo ?? 4} />
      <RepsRow label="R/ambos" value={serie.reps_ambos ?? 8} />
    </>
  );
}

function CamposForzadas({ serie, onChange, abrirSelector, done }) {
  const est = resolverEstadoPeso(serie, done, 'peso_fz', 'unidad_fz', 'peso_sugerido');
  return (
    <>
      <RepsRow label="Solo"  value={serie.reps_fz  ?? serie.reps} />
      <RepsRow label="Asist" value={serie.reps_asistidas ?? '–'} />
      <PesoTrigger
        estado={est.estado}
        valor={est.valor}
        unidad={est.unidad}
        onPress={() => abrirPeso(abrirSelector, 'peso_fz', 'unidad_fz', 'kg', serie, onChange, est.valor, est.unidad)}
        onToggleUnidad={() => toggleUnidadPeso({
          onChange,
          pesoKey: 'peso_fz', unidadKey: 'unidad_fz', sugeridoKey: 'peso_sugerido',
          estadoActual: est.estado, valorActual: est.valor, unidadActual: est.unidad,
        })} />
    </>
  );
}

function CamposSimple({ serie, onChange, abrirSelector, pesoKey, done }) {
  const unidadKey = pesoKey === 'peso_pc' ? 'unidad_pc' : 'unidad_ng';
  const repsKey   = pesoKey === 'peso_pc' ? 'reps_pc'   : 'reps_ng';
  const est = resolverEstadoPeso(serie, done, pesoKey, unidadKey, null);
  return (
    <>
      <RepsRow label="Reps" value={serie[repsKey] ?? serie.reps} />
      <PesoTrigger
        estado={est.estado}
        valor={est.valor}
        unidad={est.unidad}
        onPress={() => abrirPeso(abrirSelector, pesoKey, unidadKey, 'kg', serie, onChange, est.valor, est.unidad)}
        onToggleUnidad={() => toggleUnidadPeso({
          onChange,
          pesoKey, unidadKey, sugeridoKey: null,
          estadoActual: est.estado, valorActual: est.valor, unidadActual: est.unidad,
        })} />
    </>
  );
}

/* ─────────────────────────────────────────
   VIDEO MODAL
───────────────────────────────────────── */
function resolverEmbedUrl(url) {
  if (!url) return null;
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1&rel=0`;
  const vmMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vmMatch) return `https://player.vimeo.com/video/${vmMatch[1]}?autoplay=1`;
  return null;
}

// Reproductor para los videos que subimos nosotros (mp4 en R2, no YouTube/Vimeo)
function VideoDirecto({ url }) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
    p.play();
  });

  return (
    <VideoView
      style={vs.player}
      player={player}
      nativeControls
      allowsFullscreen
      contentFit="contain"
    />
  );
}

function VideoModal({ visible, url, titulo, onClose }) {
  const embedUrl = resolverEmbedUrl(url);
  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={vs.fullWrap}>
        <View style={vs.playerFull}>
          {/* Montamos el player solo mientras el modal está visible, así se
              pausa/libera solo al cerrar en vez de seguir sonando de fondo. */}
          {visible && (
            embedUrl ? (
              <WebView source={{ uri: embedUrl }} style={vs.player}
                allowsFullscreenVideo javaScriptEnabled mediaPlaybackRequiresUserAction={false} />
            ) : url ? (
              <VideoDirecto url={url} />
            ) : (
              <View style={vs.sinVideo}>
                <Text style={vs.sinVideoTxt}>Sin video disponible</Text>
              </View>
            )
          )}
        </View>

        <View style={vs.topBar} pointerEvents="box-none">
          <View style={vs.topBarScrim} pointerEvents="none" />
          <Text style={vs.tituloFull} numberOfLines={1}>{titulo}</Text>
          <TouchableOpacity onPress={onClose} style={vs.cerrarBtnFull} activeOpacity={0.8}>
            <Text style={vs.cerrarTxtFull}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

/* ─────────────────────────────────────────
   ESTILOS
───────────────────────────────────────── */
const vs = StyleSheet.create({
  fullWrap:      { flex:1, backgroundColor:'#000' },
  playerFull:    { flex:1, justifyContent:'center' },
  player:        { flex:1, backgroundColor:'#000' },
  sinVideo:      { flex:1, alignItems:'center', justifyContent:'center' },
  sinVideoTxt:   { color:'#6b7280', fontSize:13 },

  topBar:        { position:'absolute', top:0, left:0, right:0,
                   flexDirection:'row', alignItems:'center',
                   paddingTop:52, paddingHorizontal:16, paddingBottom:16 },
  topBarScrim:   { ...StyleSheet.absoluteFillObject, backgroundColor:'rgba(0,0,0,0.5)' },
  tituloFull:    { flex:1, fontSize:15, fontWeight:'700', color:'#fff' },
  cerrarBtnFull: { width:34, height:34, borderRadius:17, backgroundColor:'rgba(255,255,255,0.16)',
                   borderWidth:1, borderColor:'rgba(255,255,255,0.28)',
                   alignItems:'center', justifyContent:'center', marginLeft:12 },
  cerrarTxtFull: { color:'#fff', fontSize:15, fontWeight:'700' },
});

const s = StyleSheet.create({
  container:   { flex:1, backgroundColor:'#f4f5f7', padding:12 },
  center:      { flex:1, justifyContent:'center', alignItems:'center', backgroundColor:'#f4f5f7', padding:24 },
  loadingText: { color:'#2563eb', fontSize:14, marginTop:10 },
  errorText:   { color:'#dc2626', fontSize:15, fontWeight:'500', textAlign:'center' },
  errorSub:    { color:'#9ca3af', fontSize:12, marginTop:6, textAlign:'center' },
  emptyText:   { color:'#6b7280', fontSize:14, textAlign:'center' },

  // ── Header mejorado ──
  header:         { marginBottom:10, paddingHorizontal:4 },
  headerSub:      { fontSize:10, color:'#64748B', textTransform:'uppercase', letterSpacing:0.8 },
  headerRow:      { flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginTop:2 },
  headerTitle:    { fontSize:22, fontWeight:'800', color:'#111827', flex:1 },
  headerChip:     { backgroundColor:'#1E293B', borderRadius:99, paddingHorizontal:10,
                    paddingVertical:4, borderWidth:1, borderColor:'#334155' },
  headerChipText: { color:'#64748B', fontSize:11, fontWeight:'600' },
  saveLabel:      { fontSize:11, marginTop:4 },

  notaSesionCard: { backgroundColor:'#fffbeb', borderLeftWidth:3, borderLeftColor:'#f59e0b',
                    borderRadius:6, padding:10, marginBottom:12 },
  notaSesionLabel:{ fontSize:9, fontWeight:'700', color:'#92400e', textTransform:'uppercase',
                    letterSpacing:0.6, marginBottom:4 },
  notaSesionText: { fontSize:13, color:'#78350f', lineHeight:18 },

  notaEjWrap: { backgroundColor:'#fffbeb', borderLeftWidth:2, borderLeftColor:'#f59e0b',
                paddingHorizontal:8, paddingVertical:4, marginBottom:4 },
  notaEjText: { fontSize:11, color:'#92400e', lineHeight:15 },

  bloque:       { backgroundColor:'#fff', borderWidth:1.5, borderColor:'#e2e5ea',
                  borderRadius:10, marginBottom:10, overflow:'hidden' },
  bloqueHeader: { flexDirection:'row', alignItems:'center', gap:8, paddingVertical:7,
                  paddingHorizontal:12, borderBottomWidth:1, borderBottomColor:'#e2e5ea',
                  backgroundColor:'#f5f6f8', flexWrap:'wrap' },
  bloqueTag:     { paddingHorizontal:8, paddingVertical:2, borderRadius:99 },
  bloqueTagText: { fontSize:9, fontWeight:'700', letterSpacing:0.8 },
  bloqueNombre:  { fontSize:11, color:'#6b7280', flex:1 },

  seriesHeaderRow:   { flexDirection:'row', borderBottomWidth:2, borderBottomColor:'#e2e5ea', backgroundColor:'#f0f2f5' },
  colInfoHeader:     { flex:1, borderRightWidth:1, borderRightColor:'#e2e5ea', paddingVertical:5, paddingHorizontal:10, justifyContent:'center' },
  colInfoHeaderText: { fontSize:9, fontWeight:'700', color:'#6b7280', textTransform:'uppercase', letterSpacing:0.6 },

  ejercicioRow:       { flexDirection:'row', alignItems:'stretch', minHeight:54 },
  ejercicioRowBorder: { borderBottomWidth:1, borderBottomColor:'#e2e5ea' },

  colImg: { width:120, borderRightWidth:1, borderRightColor:'#e2e5ea',
            alignItems:'center', justifyContent:'center' },
  ejImgSmall:           { width:120, height:120, backgroundColor:'#f4f5f7' },
  ejImgPlaceholder:     { width:120, height:120, backgroundColor:'#f4f5f7',
                          borderWidth:1, borderColor:'#d0d5dd', alignItems:'center', justifyContent:'center' },
  ejImgPlaceholderText: { fontSize:14, color:'#9ca3af' },
  playBadge:    { position:'absolute', top:5, right:5, width:26, height:26, borderRadius:13,
                  backgroundColor:'rgba(0,0,0,0.65)', alignItems:'center', justifyContent:'center' },
  playBadgeTxt: { color:'white', fontSize:10 },
  videoPlayCircleWrap: { position:'absolute', top:6, right:6 },
  videoPlayCircle: { width:24, height:24, borderRadius:12, backgroundColor:'rgba(17,24,39,0.62)',
                      alignItems:'center', justifyContent:'center',
                      borderWidth:1, borderColor:'rgba(255,255,255,0.8)',
                      shadowColor:'#000', shadowOpacity:0.25, shadowRadius:3, shadowOffset:{width:0,height:1},
                      elevation:3 },
  videoPlayIcon: { fontSize:9, color:'#fff', marginLeft:1 },

  colDerecha: { flex:1, flexDirection:'column' },

  // ── Nombre ejercicio mejorado ──
  ejNombreWrap:     { flexDirection:'row', alignItems:'center', justifyContent:'space-between',
                      paddingHorizontal:10, paddingVertical:8, borderBottomWidth:1,
                      borderBottomColor:'#e2e5ea', backgroundColor:'#fafbfc', gap:6 },
  ejNombre:         { fontSize:13, fontWeight:'800', color:'#111827', flex:1, lineHeight:17 },
  ejMetodoBadge:    { backgroundColor:'#eff6ff', borderRadius:99, paddingHorizontal:7,
                      paddingVertical:2, flexShrink:0 },
  ejMetodoBadgeText:{ fontSize:9, fontWeight:'700', color:'#2563eb' },

  colSeriesScrollContent: { padding:5, alignItems:'stretch' },
  serieCol:      { width:120, flexDirection:'column', alignItems:'center', backgroundColor:'white',
                   borderWidth:1, borderColor:'#e2e5ea', borderRadius:6, paddingVertical:7, paddingHorizontal:6 },
  serieColDone:  { borderColor:'#86efac', backgroundColor:'#f0fdf4' },
  metodoTag:     { backgroundColor:'#eff6ff', borderRadius:99, paddingHorizontal:5, paddingVertical:1, marginBottom:3 },
  metodoTagText: { fontSize:8, fontWeight:'700', color:'#2563eb', textTransform:'uppercase' },
  serieNum:      { fontSize:9, fontWeight:'700', color:'#6b7280', marginBottom:4 },
  checkBadge:    { position:'absolute', top:3, right:3, width:14, height:14, borderRadius:7,
                   backgroundColor:'#22c55e', alignItems:'center', justifyContent:'center' },
  checkText:     { fontSize:8, color:'white', fontWeight:'700' },

  tempoBadge: { width:'100%', backgroundColor:'#eff6ff', borderRadius:4,
                paddingVertical:3, paddingHorizontal:4, marginTop:4, alignItems:'center' },
  tempoLabel: { fontSize:7, fontWeight:'700', color:'#93c5fd', letterSpacing:0.5, textTransform:'uppercase' },
  tempoVal:   { fontSize:9, fontWeight:'700', color:'#1d4ed8', marginTop:1 },

  rirBadge: { width:'100%', backgroundColor:'#f5f3ff', borderRadius:4,
              paddingVertical:3, paddingHorizontal:4, marginTop:3, alignItems:'center' },
  rirText:  { fontSize:9, fontWeight:'700', color:'#7c3aed' },

  // ── Descanso por serie ──
  descansoSerieBadge:     { width:'100%', backgroundColor:'#ecfdf5', borderRadius:4,
                            paddingVertical:3, paddingHorizontal:4, marginTop:3,
                            alignItems:'center', borderWidth:1, borderColor:'#a7f3d0' },
  descansoSerieBadgeText: { fontSize:9, fontWeight:'700', color:'#059669' },

  // ── Peso: normal / sugerido ──
  pesoWrap:            { width:'100%', marginTop:4 },
  pesoRow:             { flexDirection:'row', alignItems:'center', width:'100%', gap:3 },
  pesoTrigger:         { flex:1, flexDirection:'row', alignItems:'center', justifyContent:'space-between',
                         height:32, borderWidth:1.5, borderColor:'#d0d5dd', borderRadius:6,
                         paddingHorizontal:7, backgroundColor:'white' },
  pesoTriggerVacio:    { borderColor:'#fcd34d', borderStyle:'dashed', backgroundColor:'#fffbeb' },
  pesoTriggerSugerido: { borderColor:'#93c5fd', borderStyle:'dashed', backgroundColor:'#eff6ff' },
  pesoTriggerVal:      { fontSize:14, fontWeight:'600', color:'#111827', flex:1 },
  pesoTriggerValVacio: { color:'#d97706' },
  pesoTriggerValSugerido: { fontSize:14, fontWeight:'700', color:'#2563eb', flex:1 },
  pesoTriggerArr:      { fontSize:10, color:'#9ca3af' },
  pesoSugeridoNota:    { fontSize:8, color:'#60a5fa', fontWeight:'600', marginTop:2, textAlign:'center' },
  unidadBtn:           { width:28, height:32, borderWidth:1, borderColor:'#d0d5dd', borderRadius:6,
                         alignItems:'center', justifyContent:'center', backgroundColor:'#f9fafb' },
  unidadBtnText:       { fontSize:9, color:'#6b7280', fontWeight:'600' },

  repsRow:      { flexDirection:'row', justifyContent:'space-between', alignItems:'center', width:'100%', marginTop:2 },
  repsRowLabel: { fontSize:9, color:'#9ca3af', fontWeight:'500' },
  repsRowVal:   { fontSize:13, fontWeight:'600', color:'#374151' },
  pesoSubLabel: { fontSize:9, color:'#9ca3af', fontWeight:'500', alignSelf:'flex-start', marginTop:4 },

  metodoNota:     { backgroundColor:'#eff6ff', borderRadius:3, paddingHorizontal:4,
                    paddingVertical:2, width:'100%', marginTop:3 },
  metodoNotaText: { fontSize:8, color:'#2563eb', textAlign:'center' },

  botonesSerieRow: { padding:10, borderTopWidth:1, borderTopColor:'#e2e5ea', backgroundColor:'#f8f9fb' },
  btnSerie:        { paddingVertical:10, borderRadius:8, backgroundColor:'#e0e7ff',
                     alignItems:'center', borderWidth:1, borderColor:'#c7d2fe' },
  btnSerieDone:    { backgroundColor:'#dcfce7', borderColor:'#86efac' },
  btnSerieTxt:     { fontSize:13, fontWeight:'700', color:'#4f46e5' },
  btnSerieTxtDone: { color:'#16a34a' },

  modalWrap:      { flex:1, justifyContent:'flex-end' },
  modalFondo:     { flex:1, backgroundColor:'rgba(0,0,0,0.45)' },
  modalSheet:     { backgroundColor:'white', borderTopLeftRadius:18, borderTopRightRadius:18, maxHeight:'60%' },
  modalHandle:    { width:40, height:4, backgroundColor:'#e2e5ea', borderRadius:2,
                    alignSelf:'center', marginTop:10, marginBottom:2 },
  modalTitle:     { fontSize:14, fontWeight:'700', color:'#111827', textAlign:'center',
                    paddingVertical:12, borderBottomWidth:1, borderBottomColor:'#f3f4f6' },

  // ── Entrada manual de peso ──
  pesoInputWrap:        { paddingHorizontal:24, paddingTop:24, paddingBottom:8, alignItems:'center' },
  pesoInput:            { fontSize:36, fontWeight:'800', color:'#111827', textAlign:'center',
                          minWidth:140, paddingVertical:6, paddingHorizontal:12,
                          borderBottomWidth:2, borderBottomColor:'#2563eb' },
  pesoInputBtnRow:      { flexDirection:'row', gap:10, paddingHorizontal:20, paddingTop:16, paddingBottom:28 },
  pesoInputBtnLimpiar:  { flex:1, paddingVertical:13, borderRadius:10, borderWidth:1.5,
                          borderColor:'#e2e5ea', alignItems:'center', backgroundColor:'white' },
  pesoInputBtnLimpiarTxt: { fontSize:14, fontWeight:'700', color:'#6b7280' },
  pesoInputBtnConfirmar: { flex:2, paddingVertical:13, borderRadius:10,
                          backgroundColor:'#2563eb', alignItems:'center' },
  pesoInputBtnConfirmarTxt: { fontSize:14, fontWeight:'700', color:'white' },

  toast:     { position:'absolute', bottom:32, alignSelf:'center', backgroundColor:'#111827',
               borderRadius:99, paddingVertical:8, paddingHorizontal:20 },
  toastText: { color:'white', fontSize:13, fontWeight:'500' },
});