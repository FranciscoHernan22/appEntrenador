import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView,
  Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { API_URL } from '../config';

export default function LoginScreen({ navigation }) {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Ingresa tu email y contraseña');
      return;
    }

    setLoading(true);
    try {
      const res  = await fetch(`${API_URL}/login`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept':       'application/json',
        },
        body:    JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        Alert.alert('Error', data.error ?? 'Error al iniciar sesión');
        return;
      }

      // Guardar token y datos del cliente
      await AsyncStorage.setItem('token',      data.token);
      await AsyncStorage.setItem('cliente_id', String(data.cliente_id));
      await AsyncStorage.setItem('nombre',     data.nombre);

      navigation.replace('Home');
    } catch (e) {
      Alert.alert('Error', 'No se pudo conectar al servidor');
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.inner}
      >
        {/* Logo / título */}
        <View style={styles.logoWrap}>
          <Text style={styles.logoIcon}>💪</Text>
          <Text style={styles.logoTitulo}>GymApp</Text>
          <Text style={styles.logoSub}>Tu entrenamiento personalizado</Text>
        </View>

        {/* Formulario */}
        <View style={styles.form}>
          <Text style={styles.label}>Correo electrónico</Text>
          <TextInput
            style={styles.input}
            placeholder="tucorreo@email.com"
            placeholderTextColor="#475569"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            value={email}
            onChangeText={setEmail}
          />

          <Text style={styles.label}>Contraseña</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor="#475569"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <TouchableOpacity
            style={[styles.btnLogin, loading && { opacity: 0.7 }]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="white" />
              : <Text style={styles.btnLoginText}>Iniciar sesión</Text>
            }
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>
          ¿Problemas para acceder? Contacta a tu entrenador
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  inner: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },

  // Logo
  logoWrap: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logoIcon: {
    fontSize: 56,
    marginBottom: 10,
  },
  logoTitulo: {
    color: '#F8FAFC',
    fontSize: 32,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  logoSub: {
    color: '#64748B',
    fontSize: 14,
    marginTop: 6,
  },

  // Form
  form: {
    gap: 8,
  },
  label: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
    marginTop: 8,
  },
  input: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 14,
    color: '#F1F5F9',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#334155',
  },
  btnLogin: {
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 24,
  },
  btnLoginText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
  },

  footer: {
    color: '#475569',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 32,
  },
});