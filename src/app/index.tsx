import React, { useState, useEffect, useCallback, memo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  Alert,
  StatusBar,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Animated,
  Dimensions,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import DateTimePicker from '@react-native-community/datetimepicker';

// Expo Go Android: notifications crash natively, mock them for UI testing
const isExpoGoAndroid = Constants.appOwnership === 'expo' && Platform.OS === 'android';

let Notifications: any = {};

if (isExpoGoAndroid) {
  Notifications = {
    setNotificationHandler: () => {},
    addNotificationResponseReceivedListener: () => ({ remove: () => {} }),
    getPermissionsAsync: async () => ({ status: 'granted' }),
    requestPermissionsAsync: async () => ({ status: 'granted' }),
    cancelScheduledNotificationAsync: async () => {},
    scheduleNotificationAsync: async (req: any) => {
      Alert.alert(
        `[MOCK] ${req.content.title}`,
        `${req.content.body}\n\n(Real notifications need a dev build)`
      );
      return Math.random().toString();
    },
    SchedulableTriggerInputTypes: {
      TIME_INTERVAL: 'timeInterval',
      DAILY: 'daily',
    },
  };
} else {
  Notifications = require('expo-notifications');
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ─── Skeleton Loader (memo'd, no re-renders) ────────────────────────
const SkeletonTask = memo(() => {
  const opacity = React.useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.8, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View style={[styles.taskCard, { opacity }]}>
      <View style={styles.taskInfo}>
        <View style={styles.skeletonTitle} />
        <View style={styles.skeletonDesc} />
      </View>
      <View style={styles.taskActions}>
        <View style={styles.skeletonBtn} />
      </View>
    </Animated.View>
  );
});

// ─── Task Card (memo'd to prevent FlatList re-renders) ───────────────
const TaskCard = memo(({ item, onCopy, onDelete }: {
  item: any;
  onCopy: (text: string) => void;
  onDelete: (id: string) => void;
}) => {
  const showCopy = item.description &&
    !item.description.startsWith('Repeats') &&
    !item.description.startsWith('Daily');

  return (
    <View style={styles.taskCard}>
      <View style={styles.taskInfo}>
        <Text style={styles.taskTitle}>
          {item.title}{item.time ? ` · ${item.time}` : ''}
        </Text>
        {item.createdAt && (
          <Text style={styles.taskCreatedAt}>Created at {item.createdAt}</Text>
        )}
        <Text style={styles.taskDesc} numberOfLines={2}>{item.description}</Text>
      </View>
      <View style={styles.taskActions}>
        {showCopy && (
          <TouchableOpacity style={styles.copyBtn} onPress={() => onCopy(item.description)}>
            <Text style={styles.copyBtnText}>Copy</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.deleteBtn} onPress={() => onDelete(item.id)}>
          <Text style={styles.deleteBtnText}>✕</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

// ─── Main App ────────────────────────────────────────────────────────
export default function App() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [selectedDraft, setSelectedDraft] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [isModalVisible, setModalVisible] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customDesc, setCustomDesc] = useState('');
  const [createdTime, setCreatedTime] = useState(new Date().toLocaleTimeString());  
  const [customTime, setCustomTime] = useState(new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [scheduleType, setScheduleType] = useState<'daily' | 'once' | 'interval'>('daily');
  const [intervalMinutes, setIntervalMinutes] = useState('1');

  const formatTime = useCallback((date: Date) => {
    let h = date.getHours();
    const m = date.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m < 10 ? '0' + m : m} ${ampm}`;
  }, []);

  useEffect(() => {
    const init = async () => {
      // permissions
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') {
        const { status: s } = await Notifications.requestPermissionsAsync();
        if (s !== 'granted') {
          Alert.alert('Permission Required', 'Enable notifications in settings.');
        }
      }
      // load tasks
      try {
        const stored = await AsyncStorage.getItem('@active_tasks');
        if (stored) setTasks(JSON.parse(stored));
      } catch {}
      setIsLoading(false);
    };
    init();

    const sub = Notifications.addNotificationResponseReceivedListener((r: any) => {
      const d = r.notification.request.content.data;
      if (d?.draftText) setSelectedDraft(d.draftText);
    });
    return () => sub.remove();
  }, []);

  const copyToClipboard = useCallback(async (text: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied!', 'Text copied to clipboard.');
  }, []);

  const removeTask = useCallback(async (id: string) => {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
      const stored = await AsyncStorage.getItem('@active_tasks');
      const current = stored ? JSON.parse(stored) : [];
      const updated = current.filter((t: any) => t.id !== id);
      setTasks(updated);
      await AsyncStorage.setItem('@active_tasks', JSON.stringify(updated));
    } catch {}
  }, []);

  const scheduleTask = useCallback(async () => {
    if (!customTitle.trim()) {
      Alert.alert('Error', 'Please provide a title.');
      return;
    }

    let trigger: any;
    let desc = '';
    let time = '';

    if (scheduleType === 'interval') {
      const mins = parseInt(intervalMinutes, 10);
      if (isNaN(mins) || mins < 1) {
        Alert.alert('Error', 'Provide valid minutes.');
        return;
      }
      trigger = {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: mins * 60,
        repeats: true,
      };
      desc = customDesc || `Every ${mins}m`;
      time = `Every ${mins}m`;
    } else {
      const h = customTime.getHours();
      const m = customTime.getMinutes();
      const ft = formatTime(customTime);
      time = ft;

      if (scheduleType === 'daily') {
        trigger = { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: h, minute: m };
        desc = customDesc || `Daily at ${ft}`;
      } else {
        const d = new Date();
        d.setHours(h, m, 0, 0);
        if (d <= new Date()) d.setDate(d.getDate() + 1);
        trigger = { date: d };
        desc = customDesc || `Once at ${ft}`;
      }
    }

    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: customTitle,
          body: customDesc || 'Reminder',
          data: { type: 'custom', draftText: customDesc },
        },
        trigger,
      });

      const newTask = { 
        id, 
        title: customTitle, 
        description: desc, 
        time, 
        type: `custom_${Date.now()}`,
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      const stored = await AsyncStorage.getItem('@active_tasks');
      const current = stored ? JSON.parse(stored) : [];

      // cancel if same type exists
      const existing = current.find((t: any) => t.type === newTask.type);
      if (existing) await Notifications.cancelScheduledNotificationAsync(existing.id);

      const updated = [...current.filter((t: any) => t.type !== newTask.type), newTask];
      setTasks(updated);
      await AsyncStorage.setItem('@active_tasks', JSON.stringify(updated));
      Alert.alert('Done!', `${customTitle} scheduled.`);

      setModalVisible(false);
      setCustomTitle('');
      setCustomDesc('');
      setCustomTime(new Date());
      setCreatedTime(new Date().toLocaleTimeString());
      setScheduleType('daily');
      setIntervalMinutes('1');
    } catch {
      Alert.alert('Error', 'Failed to schedule.');
    }
  }, [customTitle, customDesc, customTime, scheduleType, intervalMinutes, formatTime]);

  const renderTask = useCallback(({ item }: any) => (
    <TaskCard item={item} onCopy={copyToClipboard} onDelete={removeTask} />
  ), [copyToClipboard, removeTask]);

  const keyExtractor = useCallback((item: any) => item.id, []);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAFAFA" />
      <View style={styles.container}>

        <Text style={styles.header}>My Tasks</Text>

        {/* Draft banner */}
        {selectedDraft && (
          <View style={styles.draftCard}>
            <Text style={styles.draftLabel}>DRAFT MESSAGE</Text>
            <Text style={styles.draftText} selectable>{selectedDraft}</Text>
            <View style={styles.draftRow}>
              <TouchableOpacity style={styles.draftCopyBtn} onPress={() => copyToClipboard(selectedDraft)}>
                <Text style={styles.draftCopyText}>Copy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.draftDismissBtn} onPress={() => setSelectedDraft(null)}>
                <Text style={styles.draftDismissText}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Task list or skeleton */}
        {isLoading ? (
          <View style={styles.listPad}>
            <SkeletonTask />
            <SkeletonTask />
            <SkeletonTask />
          </View>
        ) : (
          <FlatList
            data={tasks}
            keyExtractor={keyExtractor}
            renderItem={renderTask}
            contentContainerStyle={styles.listPad}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={5}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No tasks yet</Text>
                <Text style={styles.emptySub}>Tap the button below to create one.</Text>
              </View>
            }
          />
        )}

        {/* CTA */}
        <View style={styles.cta}>
          <TouchableOpacity
            style={styles.ctaBtn}
            activeOpacity={0.85}
            onPress={() => setModalVisible(true)}
          >
            <Text style={styles.ctaText}>+ New Reminder</Text>
          </TouchableOpacity>
        </View>

        {/* Create Modal */}
        <Modal
          visible={isModalVisible}
          animationType={Platform.OS === 'ios' ? 'slide' : 'fade'}
          transparent
          statusBarTranslucent
        >
          <KeyboardAvoidingView
            style={styles.overlay}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <TouchableOpacity
              style={styles.overlayBg}
              activeOpacity={1}
              onPress={() => setModalVisible(false)}
            />
            <View style={styles.sheet}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>New Task</Text>

              <Text style={styles.label}>Title</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Message Client"
                value={customTitle}
                onChangeText={setCustomTitle}
                placeholderTextColor="#a1a1aa"
              />

              <Text style={styles.label}>Description</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Draft message..."
                value={customDesc}
                onChangeText={setCustomDesc}
                multiline
                textAlignVertical="top"
                placeholderTextColor="#a1a1aa"
              />

              <Text style={styles.label}>Type</Text>
              <View style={styles.typeRow}>
                {(['daily', 'once', 'interval'] as const).map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.typeBtn, scheduleType === t && styles.typeBtnActive]}
                    onPress={() => setScheduleType(t)}
                  >
                    <Text style={[styles.typeBtnText, scheduleType === t && styles.typeBtnTextActive]}>
                      {t === 'daily' ? 'Daily' : t === 'once' ? 'Once' : 'Interval'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {scheduleType === 'interval' ? (
                <>
                  <Text style={styles.label}>Every (minutes)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 5"
                    value={intervalMinutes}
                    onChangeText={setIntervalMinutes}
                    keyboardType="numeric"
                    placeholderTextColor="#a1a1aa"
                  />
                </>
              ) : (
                <>
                  <Text style={styles.label}>Time</Text>
                  {Platform.OS === 'ios' ? (
                    <DateTimePicker
                      value={customTime}
                      mode="time"
                      display="spinner"
                      onChange={(_, d) => d && setCustomTime(d)}
                      style={{ height: 120, alignSelf: 'flex-start' }}
                    />
                  ) : (
                    <>
                      <TouchableOpacity
                        style={[styles.input, { justifyContent: 'center', height: 48 }]}
                        onPress={() => setShowTimePicker(true)}
                      >
                        <Text style={{ fontSize: 15, color: '#09090b' }}>
                          {formatTime(customTime)}
                        </Text>
                      </TouchableOpacity>
                      {showTimePicker && (
                        <DateTimePicker
                          value={customTime}
                          mode="time"
                          is24Hour={false}
                          display="default"
                          onChange={(e, d) => {
                            setShowTimePicker(false);
                            if (e.type === 'set' && d) setCustomTime(d);
                          }}
                        />
                      )}
                    </>
                  )}
                </>
              )}

              <View style={styles.sheetActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={scheduleTask}>
                  <Text style={styles.saveText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────
const { width } = Dimensions.get('window');
const isSmall = width < 375;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAFAFA' },
  container: { flex: 1, paddingTop: isSmall ? 16 : 24, paddingHorizontal: isSmall ? 16 : 20 },

  header: {
    fontSize: isSmall ? 26 : 30,
    fontWeight: '800',
    color: '#09090b',
    marginBottom: isSmall ? 16 : 24,
    letterSpacing: -0.6,
  },

  // Draft
  draftCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#09090b',
    borderWidth: 1,
    borderColor: '#e4e4e7',
  },
  draftLabel: { fontSize: 11, fontWeight: '700', color: '#71717a', letterSpacing: 0.5, marginBottom: 8 },
  draftText: { fontSize: 15, color: '#09090b', lineHeight: 22, marginBottom: 12 },
  draftRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  draftCopyBtn: { paddingVertical: 7, paddingHorizontal: 14, backgroundColor: '#09090b', borderRadius: 6 },
  draftCopyText: { fontSize: 13, color: '#fff', fontWeight: '600' },
  draftDismissBtn: { paddingVertical: 7, paddingHorizontal: 14, borderWidth: 1, borderColor: '#e4e4e7', borderRadius: 6 },
  draftDismissText: { fontSize: 13, color: '#09090b', fontWeight: '600' },

  // List
  listPad: { paddingBottom: 16 },
  empty: { alignItems: 'center', marginTop: 60 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: '#09090b', marginBottom: 6 },
  emptySub: { fontSize: 14, color: '#71717a' },

  // Task Card
  taskCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: isSmall ? 14 : 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  taskInfo: { flex: 1, paddingRight: 10 },
  taskTitle: { fontSize: isSmall ? 14 : 15, fontWeight: '700', color: '#09090b', marginBottom: 3 },
  taskCreatedAt: { fontSize: 11, color: '#a1a1aa', marginBottom: 4, fontStyle: 'italic', fontWeight: '500' },
  taskDesc: { fontSize: 13, color: '#71717a', fontWeight: '400' },
  taskActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  copyBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#e4e4e7',
    borderRadius: 6,
  },
  copyBtnText: { color: '#09090b', fontWeight: '600', fontSize: 12 },
  deleteBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#fef2f2',
    borderRadius: 6,
  },
  deleteBtnText: { color: '#ef4444', fontWeight: '700', fontSize: 13 },

  // CTA
  cta: { paddingTop: 12, paddingBottom: 20 },
  ctaBtn: {
    backgroundColor: '#09090b',
    borderRadius: 10,
    paddingVertical: isSmall ? 14 : 16,
    alignItems: 'center',
  },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  // Modal
  overlay: { flex: 1, justifyContent: 'flex-end' },
  overlayBg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: isSmall ? 20 : 24,
    paddingBottom: 36,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#e4e4e7',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: '#09090b', marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: '#09090b', marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: '#e4e4e7',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: '#09090b',
  },
  textArea: { height: 90 },
  typeRow: { flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 4 },
  typeBtn: {
    flex: 1,
    paddingVertical: 9,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e4e4e7',
    borderRadius: 8,
    alignItems: 'center',
  },
  typeBtnActive: { backgroundColor: '#09090b', borderColor: '#09090b' },
  typeBtnText: { fontSize: 13, fontWeight: '600', color: '#71717a' },
  typeBtnTextActive: { color: '#fff' },
  sheetActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e4e4e7',
    alignItems: 'center',
  },
  cancelText: { color: '#09090b', fontWeight: '600', fontSize: 15 },
  saveBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 8,
    backgroundColor: '#09090b',
    alignItems: 'center',
  },
  saveText: { color: '#fff', fontWeight: '600', fontSize: 15 },

  // Skeleton
  skeletonTitle: { height: 16, backgroundColor: '#e4e4e7', borderRadius: 4, marginBottom: 8, width: '55%' },
  skeletonDesc: { height: 12, backgroundColor: '#e4e4e7', borderRadius: 4, width: '80%' },
  skeletonBtn: { height: 26, width: 44, backgroundColor: '#e4e4e7', borderRadius: 6 },
});
