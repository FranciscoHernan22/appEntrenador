import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, Modal, StyleSheet,
  Image, TouchableOpacity, ActivityIndicator,
  Dimensions,
} from 'react-native';
import { WebView } from 'react-native-webview';

const API_BASE = 'http://192.168.0.254:8000';
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

function serieCompleta(serie) {
  const m = serie.metodo ?? 'normal';
  if (m === '888')       return !!(serie.peso1 && serie.peso2 && serie.peso3);
  if (m === '21s')       return !!serie.peso_21s;
  if (m === '10_21')     return !!serie.peso_10;
  if (m === 'isometria') return !!serie.peso_iso;
  if (m === 'forzadas')  return !!serie.peso_fz;
  if (m === 'parciales') return !!serie.peso_pc;
  if (m === 'negativas') return !!serie.peso_ng;
  return !!serie.peso;
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
function ImagenModal({ visible, uri, nombre, onClose }) {
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
        {!!nombre && (
          <View style={im.nombreWrap}>
            <Text style={im.nombreText} numberOfLines={2}>{nombre}</Text>
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
  nombreWrap: { position:'absolute', bottom:48, left:0, right:0, alignItems:'center', paddingHorizontal:24 },
  nombreText: { fontSize:15, fontWeight:'700', color:'white', textAlign:'center',
                textShadowColor:'rgba(0,0,0,0.9)', textShadowOffset:{width:0,height:1}, textShadowRadius:6 },
  cerrarBtn:  { position:'absolute', top:52, right:20, width:36, height:36, borderRadius:18,
                backgroundColor:'rgba(255,255,255,0.15)', borderWidth:1,
                borderColor:'rgba(255,255,255,0.3)', alignItems:'center', justifyContent:'center' },
  cerrarTxt:  { color:'white', fontSize:16, fontWeight:'700' },
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
  const [selectorOpts, setSelectorOpts]       = useState([]);
  const [selectorVal, setSelectorVal]         = useState('');
  const [selectorCb, setSelectorCb]           = useState(null);
  const [selectorTitulo, setSelectorTitulo]   = useState('');

  const [videoVisible, setVideoVisible] = useState(false);
  const [videoUrl, setVideoUrl]         = useState('');
  const [videoTitulo, setVideoTitulo]   = useState('');

  const [imgModal, setImgModal] = useState({ visible:false, uri:'', nombre:'' });

  const mainScrollRef = useRef(null);
  const bloqueRefs    = useRef({});
  const saveTimer     = useRef(null);

  function abrirImagen(uri, nombre) { setImgModal({ visible:true, uri, nombre }); }
  function cerrarImagen() { setImgModal(prev => ({ ...prev, visible:false })); }
  function abrirVideo(url, nombre) { setVideoUrl(url ?? ''); setVideoTitulo(nombre ?? ''); setVideoVisible(true); }
  function abrirSelector(opciones, valorActual, titulo, callback) {
    setSelectorOpts(opciones);
    setSelectorVal(valorActual ?? '');
    setSelectorTitulo(titulo);
    setSelectorCb(() => callback);
    setSelectorVisible(true);
  }
  function cerrarSelector() { setSelectorVisible(false); }
  function seleccionarOpcion(val) { if (selectorCb) selectorCb(val); setSelectorVisible(false); }

  useEffect(() => {
    fetch(`${API_BASE}/api/rutina/${clienteId}/${semana}/${dia}`)
      .then(r => { if (!r.ok) throw new Error(`Error ${r.status}`); return r.json(); })
      .then(json => { setSesion(json); setData(cloneBloques(json.bloques ?? [])); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [clienteId, semana, dia]);

  // ── Autosave ──
  const guardarSilencioso = useCallback(async (dataActual) => {
    setSaveStatus('saving');
    try {
      const res = await fetch(
        `${API_BASE}/api/rutina/${clienteId}/${semana}/${dia}/pesos/`,
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

  function completarBloquesSerie(bi, si) {
    setData(prev => {
      const next = cloneBloques(prev);
      next[bi].ejercicios.forEach((_, ei) => {
        next[bi].ejercicios[ei].series[si].completada = true;
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
        onClose={cerrarImagen}
      />

      <Modal visible={selectorVisible} transparent animationType="slide" onRequestClose={cerrarSelector}>
        <View style={s.modalWrap}>
          <TouchableOpacity style={s.modalFondo} activeOpacity={1} onPress={cerrarSelector} />
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>{selectorTitulo}</Text>
            <ScrollView bounces={false} showsVerticalScrollIndicator={false} style={s.modalScroll}>
              {selectorOpts.map(item => {
                const sel = item.value === selectorVal;
                return (
                  <TouchableOpacity
                    key={item.value}
                    style={[s.modalOpt, sel && s.modalOptSel]}
                    onPress={() => seleccionarOpcion(item.value)}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.modalOptTxt, sel && s.modalOptTxtSel]}>{item.label}</Text>
                    {sel && <Text style={s.modalOptCheck}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
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
        {!!bloque.descanso_valor && (
          <View style={s.descansoBadge}>
            <Text style={s.descansoBadgeText}>
              💤 {bloque.descanso_valor} {bloque.descanso_unidad ?? 'seg'}
            </Text>
          </View>
        )}
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
  abrirVideo, abrirImagen, scrollsRef, serieHecha }) {

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
        onPress={() => ej.imagen && abrirImagen(ej.imagen, ej.nombre)}
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
            style={s.playBadge}
            onPress={() => abrirVideo(ej.video, ej.nombre)}
            activeOpacity={0.75}
          >
            <Text style={s.playBadgeTxt}>▶</Text>
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
function SerieCol({ serie, serieIdx, isLast, onChange, abrirSelector, done }) {
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

  return (
    <View style={[s.serieCol, done && s.serieColDone, !isLast && { marginRight:5 }]}>
      <View style={s.metodoTag}>
        <Text style={s.metodoTagText}>{METODO_LABEL[m] ?? m}</Text>
      </View>
      <Text style={s.serieNum}>S{serieIdx + 1}</Text>

      {m === 'normal'    && <CamposNormal    serie={serie} onChange={onChange} abrirSelector={abrirSelector} />}
      {m === 'restpause' && <CamposRestpause serie={serie} onChange={onChange} abrirSelector={abrirSelector} />}
      {m === '888'       && <Campos888       serie={serie} onChange={onChange} abrirSelector={abrirSelector} />}
      {m === '21s'       && <Campos21s       serie={serie} onChange={onChange} abrirSelector={abrirSelector} />}
      {m === '10_21'     && <Campos10_21     serie={serie} onChange={onChange} abrirSelector={abrirSelector} />}
      {m === 'isometria' && <CamposIsometria serie={serie} onChange={onChange} abrirSelector={abrirSelector} />}
      {m === 'forzadas'  && <CamposForzadas  serie={serie} onChange={onChange} abrirSelector={abrirSelector} />}
      {(m === 'parciales' || m === 'negativas') && (
        <CamposSimple
          serie={serie} onChange={onChange} abrirSelector={abrirSelector}
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
      {done && (
        <View style={s.checkBadge}><Text style={s.checkText}>✓</Text></View>
      )}
    </View>
  );
}

/* ─────────────────────────────────────────
   CAMPOS POR MÉTODO
───────────────────────────────────────── */
function PesoTrigger({ value, unidad, onPress, onToggleUnidad }) {
  const isEmpty = !value || value === '';
  return (
    <View style={s.pesoRow}>
      <TouchableOpacity
        style={[s.pesoTrigger, isEmpty && s.pesoTriggerVacio]}
        onPress={onPress}
        activeOpacity={0.7}
      >
        <Text style={[s.pesoTriggerVal, isEmpty && s.pesoTriggerValVacio]} numberOfLines={1}>
          {isEmpty ? '–' : `${value}`}
        </Text>
        <Text style={s.pesoTriggerArr}>▾</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.unidadBtn} onPress={onToggleUnidad} activeOpacity={0.7}>
        <Text style={s.unidadBtnText}>{unidad ?? 'kg'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function abrirPeso(abrirSelector, pesoKey, unidad, unidadKey, serie, onChange) {
  const u    = serie[unidadKey] ?? unidad ?? 'kg';
  const opts = generarOpciones(u);
  abrirSelector(opts, serie[pesoKey] ?? '', `Peso (${u})`, val => onChange(pesoKey, val));
}

function RepsRow({ label, value }) {
  return (
    <View style={s.repsRow}>
      <Text style={s.repsRowLabel}>{label}</Text>
      <Text style={s.repsRowVal}>{value ?? '–'}</Text>
    </View>
  );
}

function CamposNormal({ serie, onChange, abrirSelector }) {
  return (
    <>
      <RepsRow label="Reps" value={serie.reps} />
      <PesoTrigger value={serie.peso} unidad={serie.unidad ?? 'kg'}
        onPress={() => abrirPeso(abrirSelector, 'peso', 'kg', 'unidad', serie, onChange)}
        onToggleUnidad={() => onChange('unidad', (serie.unidad ?? 'kg') === 'kg' ? 'lb' : 'kg')} />
    </>
  );
}

function CamposRestpause({ serie, onChange, abrirSelector }) {
  return (
    <>
      <RepsRow label="Reps" value={serie.reps_rp ?? serie.reps} />
      <PesoTrigger value={serie.peso_rp ?? serie.peso} unidad={serie.unidad_rp ?? serie.unidad ?? 'kg'}
        onPress={() => abrirPeso(abrirSelector, 'peso_rp', 'kg', 'unidad_rp', serie, onChange)}
        onToggleUnidad={() => onChange('unidad_rp', (serie.unidad_rp ?? 'kg') === 'kg' ? 'lb' : 'kg')} />
      <View style={s.metodoNota}>
        <Text style={s.metodoNotaText}>Fallo → {serie.descanso ?? 15}s</Text>
      </View>
    </>
  );
}

function Campos888({ serie, onChange, abrirSelector }) {
  const r = serie.reps_888 ?? 8;
  return (
    <>
      <RepsRow label="Reps" value={`${r}+${r}+${r}`} />
      <Text style={s.pesoSubLabel}>P1</Text>
      <PesoTrigger value={serie.peso1} unidad={serie.unidad1 ?? 'kg'}
        onPress={() => abrirPeso(abrirSelector, 'peso1', 'kg', 'unidad1', serie, onChange)}
        onToggleUnidad={() => onChange('unidad1', (serie.unidad1 ?? 'kg') === 'kg' ? 'lb' : 'kg')} />
      <Text style={s.pesoSubLabel}>P2</Text>
      <PesoTrigger value={serie.peso2} unidad={serie.unidad2 ?? 'kg'}
        onPress={() => abrirPeso(abrirSelector, 'peso2', 'kg', 'unidad2', serie, onChange)}
        onToggleUnidad={() => onChange('unidad2', (serie.unidad2 ?? 'kg') === 'kg' ? 'lb' : 'kg')} />
      <Text style={s.pesoSubLabel}>P3</Text>
      <PesoTrigger value={serie.peso3} unidad={serie.unidad3 ?? 'kg'}
        onPress={() => abrirPeso(abrirSelector, 'peso3', 'kg', 'unidad3', serie, onChange)}
        onToggleUnidad={() => onChange('unidad3', (serie.unidad3 ?? 'kg') === 'kg' ? 'lb' : 'kg')} />
    </>
  );
}

function Campos21s({ serie, onChange, abrirSelector }) {
  const r = serie.reps_21s ?? 7;
  return (
    <>
      <RepsRow label="Reps" value={`${r}+${r}+${r}`} />
      <PesoTrigger value={serie.peso_21s} unidad={serie.unidad_21s ?? 'kg'}
        onPress={() => abrirPeso(abrirSelector, 'peso_21s', 'kg', 'unidad_21s', serie, onChange)}
        onToggleUnidad={() => onChange('unidad_21s', (serie.unidad_21s ?? 'kg') === 'kg' ? 'lb' : 'kg')} />
    </>
  );
}

function Campos10_21({ serie, onChange, abrirSelector }) {
  function calcular40(v) {
    const p = parseFloat(v) || 0;
    return p > 0 ? String(Math.round(p * 0.6 * 2) / 2) : '';
  }
  return (
    <>
      <Text style={s.pesoSubLabel}>×10</Text>
      <PesoTrigger value={serie.peso_10} unidad={serie.unidad_10 ?? 'kg'}
        onPress={() => abrirSelector(generarOpciones(serie.unidad_10 ?? 'kg'), serie.peso_10 ?? '', 'Peso ×10',
          v => { onChange('peso_10', v); onChange('peso_21', calcular40(v)); })}
        onToggleUnidad={() => onChange('unidad_10', (serie.unidad_10 ?? 'kg') === 'kg' ? 'lb' : 'kg')} />
      <Text style={s.pesoSubLabel}>×21s</Text>
      <PesoTrigger value={serie.peso_21} unidad={serie.unidad_21 ?? 'kg'}
        onPress={() => abrirPeso(abrirSelector, 'peso_21', 'kg', 'unidad_21', serie, onChange)}
        onToggleUnidad={() => onChange('unidad_21', (serie.unidad_21 ?? 'kg') === 'kg' ? 'lb' : 'kg')} />
      <View style={s.metodoNota}><Text style={s.metodoNotaText}>−40%→21s</Text></View>
    </>
  );
}

function CamposIsometria({ serie, onChange, abrirSelector }) {
  return (
    <>
      <PesoTrigger value={serie.peso_iso} unidad={serie.unidad_iso ?? 'kg'}
        onPress={() => abrirPeso(abrirSelector, 'peso_iso', 'kg', 'unidad_iso', serie, onChange)}
        onToggleUnidad={() => onChange('unidad_iso', (serie.unidad_iso ?? 'kg') === 'kg' ? 'lb' : 'kg')} />
      <RepsRow label="R/brazo" value={serie.reps_brazo ?? 4} />
      <RepsRow label="R/ambos" value={serie.reps_ambos ?? 8} />
    </>
  );
}

function CamposForzadas({ serie, onChange, abrirSelector }) {
  return (
    <>
      <RepsRow label="Solo"  value={serie.reps_fz  ?? serie.reps} />
      <RepsRow label="Asist" value={serie.reps_asistidas ?? '–'} />
      <PesoTrigger value={serie.peso_fz} unidad={serie.unidad_fz ?? 'kg'}
        onPress={() => abrirPeso(abrirSelector, 'peso_fz', 'kg', 'unidad_fz', serie, onChange)}
        onToggleUnidad={() => onChange('unidad_fz', (serie.unidad_fz ?? 'kg') === 'kg' ? 'lb' : 'kg')} />
    </>
  );
}

function CamposSimple({ serie, onChange, abrirSelector, pesoKey }) {
  const unidadKey = pesoKey === 'peso_pc' ? 'unidad_pc' : 'unidad_ng';
  const repsKey   = pesoKey === 'peso_pc' ? 'reps_pc'   : 'reps_ng';
  return (
    <>
      <RepsRow label="Reps" value={serie[repsKey] ?? serie.reps} />
      <PesoTrigger value={serie[pesoKey]} unidad={serie[unidadKey] ?? 'kg'}
        onPress={() => abrirPeso(abrirSelector, pesoKey, 'kg', unidadKey, serie, onChange)}
        onToggleUnidad={() => onChange(unidadKey, (serie[unidadKey] ?? 'kg') === 'kg' ? 'lb' : 'kg')} />
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

function VideoModal({ visible, url, titulo, onClose }) {
  const embedUrl = resolverEmbedUrl(url);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={vs.wrap}>
        <TouchableOpacity style={vs.fondo} activeOpacity={1} onPress={onClose} />
        <View style={vs.sheet}>
          <View style={vs.handle} />
          <View style={vs.header}>
            <Text style={vs.titulo} numberOfLines={1}>{titulo}</Text>
            <TouchableOpacity onPress={onClose} style={vs.cerrarBtn}>
              <Text style={vs.cerrarTxt}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={vs.playerWrap}>
            {embedUrl ? (
              <WebView source={{ uri: embedUrl }} style={vs.player}
                allowsFullscreenVideo javaScriptEnabled mediaPlaybackRequiresUserAction={false} />
            ) : (
              <View style={vs.sinVideo}>
                <Text style={vs.sinVideoTxt}>
                  {url ? 'Sin preview — abre en YouTube' : 'Sin video disponible'}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ─────────────────────────────────────────
   ESTILOS
───────────────────────────────────────── */
const vs = StyleSheet.create({
  wrap:        { flex:1, justifyContent:'flex-end' },
  fondo:       { flex:1, backgroundColor:'rgba(0,0,0,0.6)' },
  sheet:       { backgroundColor:'#111827', borderTopLeftRadius:18, borderTopRightRadius:18 },
  handle:      { width:40, height:4, backgroundColor:'#374151', borderRadius:2, alignSelf:'center', marginTop:10 },
  header:      { flexDirection:'row', alignItems:'center', paddingHorizontal:16, paddingVertical:10, borderBottomWidth:1, borderBottomColor:'#1f2937' },
  titulo:      { flex:1, fontSize:14, fontWeight:'700', color:'#f9fafb' },
  cerrarBtn:   { width:28, height:28, borderRadius:14, backgroundColor:'#374151', alignItems:'center', justifyContent:'center', marginLeft:8 },
  cerrarTxt:   { fontSize:12, color:'#9ca3af', fontWeight:'700' },
  playerWrap:  { width:'100%', aspectRatio:16/9, backgroundColor:'#000' },
  player:      { flex:1, backgroundColor:'#000' },
  sinVideo:    { flex:1, alignItems:'center', justifyContent:'center' },
  sinVideoTxt: { color:'#6b7280', fontSize:13 },
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
  descansoBadge: { backgroundColor:'#ecfdf5', borderRadius:99, paddingHorizontal:7,
                   paddingVertical:2, borderWidth:1, borderColor:'#a7f3d0' },
  descansoBadgeText: { fontSize:9, fontWeight:'700', color:'#059669' },

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

  pesoRow:             { flexDirection:'row', alignItems:'center', width:'100%', gap:3, marginTop:4 },
  pesoTrigger:         { flex:1, flexDirection:'row', alignItems:'center', justifyContent:'space-between',
                         height:32, borderWidth:1.5, borderColor:'#d0d5dd', borderRadius:6,
                         paddingHorizontal:7, backgroundColor:'white' },
  pesoTriggerVacio:    { borderColor:'#fcd34d', borderStyle:'dashed', backgroundColor:'#fffbeb' },
  pesoTriggerVal:      { fontSize:14, fontWeight:'600', color:'#111827', flex:1 },
  pesoTriggerValVacio: { color:'#d97706' },
  pesoTriggerArr:      { fontSize:10, color:'#9ca3af' },
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
  modalScroll:    { maxHeight:340 },
  modalOpt:       { height:48, paddingHorizontal:24, flexDirection:'row', alignItems:'center',
                    justifyContent:'space-between', borderBottomWidth:0.5, borderBottomColor:'#f3f4f6' },
  modalOptSel:    { backgroundColor:'#eff6ff' },
  modalOptTxt:    { fontSize:16, color:'#374151' },
  modalOptTxtSel: { color:'#2563eb', fontWeight:'600' },
  modalOptCheck:  { fontSize:16, color:'#2563eb' },

  toast:     { position:'absolute', bottom:32, alignSelf:'center', backgroundColor:'#111827',
               borderRadius:99, paddingVertical:8, paddingHorizontal:20 },
  toastText: { color:'white', fontSize:13, fontWeight:'500' },
});