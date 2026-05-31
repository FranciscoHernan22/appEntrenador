import React, { useEffect, useState } from 'react';
import { StatusBar, View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';

import LoginScreen  from './screens/LoginScreen.js';
import HomeScreen   from './screens/HomeScreen.js';
import PlanScreen   from './screens/PlanScreen.js';
import RutinaScreen from './screens/RutinaScreen.js';

import SemanasScreen from './screens/SemanasScreen.js';


const Stack = createNativeStackNavigator();

export default function App() {
  const [checking, setChecking] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('token').then(token => {
      setLoggedIn(!!token);
      setChecking(false);
    });
  }, []);

  if (checking) {
    return (
      <View style={{ flex:1, backgroundColor:'#0F172A', justifyContent:'center', alignItems:'center' }}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName={loggedIn ? 'Home' : 'Login'}
          screenOptions={{
            headerStyle:      { backgroundColor: '#0F172A' },
            headerTintColor:  '#fff',
            headerTitleStyle: { fontWeight: '700' },
            contentStyle:     { backgroundColor: '#0F172A' },
          }}
        >
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Home"
            component={HomeScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Plan"
            component={PlanScreen}
            options={{ title: 'Mi Semana' }}
          />
          <Stack.Screen
            name="Rutina"
            component={RutinaScreen}
            options={{ title: 'Rutina del día' }}
          />
          <Stack.Screen
  name="Semanas"
  component={SemanasScreen}
  options={{ title: 'Mis semanas' }}
/>

        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}