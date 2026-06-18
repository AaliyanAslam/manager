import React, { useState, useEffect } from 'react';
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
  KeyboardAvoidingView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import DateTimePicker from '@react-native-community/datetimepicker';

// In Expo Go on Android, expo-notifications crashes instantly. We mock it to allow UI testing.
const isExpoGoAndroid = Constants.appOwnership === 'expo' && Platform.OS === 'android';

let Notifications: any = {};

if (isExpoGoAndroid) {
  // Mock API for Expo Go Android
  Notifications = {
    setNotificationHandler: () => {},
    addNotificationResponseReceivedListener: () => ({ remove: () => {} }),
    getPermissionsAsync: async () => ({ status: 'granted' }),
    requestPermissionsAsync: async () => ({ status: 'granted' }),
    cancelScheduledNotificationAsync: async () => {},
    scheduleNotificationAsync: async (req: any) => {
      Alert.alert(
        `[MOCK NOTIFICATION] ${req.content.title}`, 
        `${req.content.body}\n\n(Notifications don't work natively in Android Expo Go, but your logic works!)`
      );
      return Math.random().toString();
    },
    SchedulableTriggerInputTypes: {
      TIME_INTERVAL: 'timeInterval',
      DAILY: 'daily'
    }
  };
} else {
  // Use real module on iOS or Custom Dev Builds
  Notifications = require('expo-notifications');
}

// 1. Configure Notification Handler to show alerts in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [selectedDraft, setSelectedDraft] = useState<string | null>(null);

  // Form State
  const [isModalVisible, setModalVisible] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customDesc, setCustomDesc] = useState('');
  const [customTime, setCustomTime] = useState(new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [scheduleType, setScheduleType] = useState<'daily' | 'once' | 'interval'>('daily');
  const [intervalMinutes, setIntervalMinutes] = useState('1');

  // Helper to format Date into hh:mm AM/PM reliably across iOS/Android
  const formatTime = (date: Date) => {
    let hours = date.getHours();
    let minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const minutesStr = minutes < 10 ? '0' + minutes : minutes.toString();
    return `${hours}:${minutesStr} ${ampm}`;
  };

  useEffect(() => {
    requestPermissions();
    loadTasks();

    const subscription = Notifications.addNotificationResponseReceivedListener((response: any) => {
      const data = response.notification.request.content.data;
      if (data && typeof data.draftText === 'string') {
        setSelectedDraft(data.draftText);
      }
    });

    return () => subscription.remove();
  }, []);

  const requestPermissions = async () => {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
      Alert.alert('Permission Required', 'Please enable notifications in your phone settings to receive reminders.');
    }
  };

  const loadTasks = async () => {
    try {
      const stored = await AsyncStorage.getItem('@active_tasks');
      if (stored !== null) {
        setTasks(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Failed to load tasks', e);
    }
  };

  const saveTaskToStorage = async (newTask: any) => {
    try {
      const stored = await AsyncStorage.getItem('@active_tasks');
      let currentTasks = stored ? JSON.parse(stored) : [];
      
      const existing = currentTasks.find((t: any) => t.type === newTask.type);
      if (existing) {
        await Notifications.cancelScheduledNotificationAsync(existing.id);
      }
      
      const updatedTasks = [...currentTasks.filter((t: any) => t.type !== newTask.type), newTask];
      setTasks(updatedTasks as any);
      await AsyncStorage.setItem('@active_tasks', JSON.stringify(updatedTasks));
      
      Alert.alert('Scheduled!', `${newTask.title} has been set successfully.`);
    } catch (e) {
      console.error('Failed to save task', e);
    }
  };

  const removeTask = async (id: string) => {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
      
      const stored = await AsyncStorage.getItem('@active_tasks');
      let currentTasks = stored ? JSON.parse(stored) : [];
      const updatedTasks = currentTasks.filter((t: any) => t.id !== id);
      
      setTasks(updatedTasks as any);
      await AsyncStorage.setItem('@active_tasks', JSON.stringify(updatedTasks));
    } catch (e) {
      console.error('Failed to remove task', e);
    }
  };

  const copyToClipboard = async (text: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied!', 'Text has been copied to your clipboard.');
  };

  const scheduleCustomTask = async () => {
    if (!customTitle) {
      Alert.alert('Validation Error', 'Please provide a title for your task.');
      return;
    }

    let trigger: any;
    let descriptionText = '';
    let timeText = '';

    if (scheduleType === 'interval') {
      const mins = parseInt(intervalMinutes, 10);
      if (isNaN(mins) || mins < 1) {
        Alert.alert('Validation Error', 'Please provide a valid interval in minutes.');
        return;
      }
      trigger = {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: mins * 60,
        repeats: true,
      };
      descriptionText = customDesc || `Repeats every ${mins} minute(s)`;
      timeText = `Every ${mins}m`;
    } else {
      const hour = customTime.getHours();
      const minute = customTime.getMinutes();
      const formattedTimeStr = formatTime(customTime);
      timeText = formattedTimeStr;

      if (scheduleType === 'daily') {
        trigger = {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour,
          minute,
        };
        descriptionText = customDesc || `Daily at ${formattedTimeStr}`;
      } else {
        const now = new Date();
        const scheduledDate = new Date();
        scheduledDate.setHours(hour, minute, 0, 0);
        if (scheduledDate <= now) {
          scheduledDate.setDate(scheduledDate.getDate() + 1);
        }
        trigger = {
          date: scheduledDate,
        };
        descriptionText = customDesc || `Once at ${formattedTimeStr}`;
      }
    }

    try {
      const identifier = await Notifications.scheduleNotificationAsync({
        content: {
          title: customTitle,
          body: customDesc || "Custom reminder",
          data: { type: 'custom', draftText: customDesc },
        },
        trigger,
      });

      await saveTaskToStorage({
        id: identifier,
        title: customTitle,
        description: descriptionText,
        time: timeText,
        type: `custom_${Date.now()}`,
      });

      setModalVisible(false);
      setCustomTitle('');
      setCustomDesc('');
      setCustomTime(new Date());
      setScheduleType('daily');
      setIntervalMinutes('1');
    } catch (error) {
      Alert.alert("Error", "Failed to schedule task.");
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#fafafa" />
      <View style={styles.container}>
        
        {/* Top Section */}
        <Text style={styles.headerTitle}>My Routine & Outreach</Text>

        {/* Selected Draft View (Appears on notification tap) */}
        {selectedDraft && (
          <View style={styles.draftCard}>
            <Text style={styles.draftTitle}>Draft Message (Long press to copy)</Text>
            <Text style={styles.draftText} selectable={true}>{selectedDraft}</Text>
            <View style={styles.draftActions}>
              <TouchableOpacity style={styles.draftCopyButton} onPress={() => copyToClipboard(selectedDraft)}>
                <Text style={styles.draftCopyButtonText}>Copy Text</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.closeButton} onPress={() => setSelectedDraft(null)}>
                <Text style={styles.closeButtonText}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Middle Section: FlatList */}
        <FlatList
          data={tasks}
          keyExtractor={(item: any) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No active tasks.</Text>
              <Text style={styles.emptySubText}>Create a new reminder below to get started.</Text>
            </View>
          }
          renderItem={({ item }: any) => (
            <View style={styles.taskCard}>
              <View style={styles.taskInfo}>
                <Text style={styles.taskTitle}>{item.title} {item.time ? `(${item.time})` : ''}</Text>
                <Text style={styles.taskDesc} numberOfLines={2}>{item.description}</Text>
              </View>
              <View style={styles.taskActions}>
                {item.description && !item.description.startsWith('Repeats') && !item.description.startsWith('Daily') && (
                  <TouchableOpacity style={styles.copyButton} onPress={() => copyToClipboard(item.description)}>
                    <Text style={styles.copyButtonText}>Copy</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.deleteButton} onPress={() => removeTask(item.id)}>
                  <Text style={styles.deleteButtonText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />

        {/* Bottom Section: Action Buttons */}
        <View style={styles.actionContainer}>
          <TouchableOpacity 
            style={styles.primaryButton} 
            activeOpacity={0.8}
            onPress={() => setModalVisible(true)}
          >
            <Text style={styles.buttonText}>+ Create Custom Reminder</Text>
          </TouchableOpacity>
        </View>

        {/* Modal for Creating Custom Reminder */}
        <Modal visible={isModalVisible} animationType="slide" transparent={true}>
          <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View style={styles.modalContent}>
              <Text style={styles.modalHeader}>Create New Task</Text>
              
              <Text style={styles.inputLabel}>Task Title</Text>
              <TextInput 
                style={styles.input} 
                placeholder="e.g. Message Ghazi Foods" 
                value={customTitle} 
                onChangeText={setCustomTitle} 
                placeholderTextColor="#a1a1aa"
              />

              <Text style={styles.inputLabel}>Draft / Description</Text>
              <TextInput 
                style={[styles.input, styles.textArea]} 
                placeholder="Message to copy later..." 
                value={customDesc} 
                onChangeText={setCustomDesc} 
                multiline 
                textAlignVertical="top"
                placeholderTextColor="#a1a1aa"
              />

              <Text style={styles.inputLabel}>Reminder Type</Text>
              <View style={styles.typeSelectorContainer}>
                {['daily', 'once', 'interval'].map((type) => (
                  <TouchableOpacity 
                    key={type}
                    style={[styles.typeButton, scheduleType === type && styles.typeButtonActive]}
                    onPress={() => setScheduleType(type as any)}
                  >
                    <Text style={[styles.typeButtonText, scheduleType === type && styles.typeButtonTextActive]}>
                      {type === 'daily' ? 'Daily' : type === 'once' ? 'Once' : 'Interval'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {scheduleType === 'interval' ? (
                <>
                  <Text style={styles.inputLabel}>Repeat Every (Minutes)</Text>
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
                  <Text style={styles.inputLabel}>Time</Text>
                  {Platform.OS === 'ios' ? (
                    <DateTimePicker
                      value={customTime}
                      mode="time"
                      display="spinner"
                      onChange={(e, d) => d && setCustomTime(d)}
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
                          onChange={(event, selectedDate) => {
                            setShowTimePicker(false);
                            if (event.type === 'set' && selectedDate) {
                              setCustomTime(selectedDate);
                            }
                          }}
                        />
                      )}
                    </>
                  )}
                </>
              )}

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancelButton} onPress={() => setModalVisible(false)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalSaveButton} onPress={scheduleCustomTask}>
                  <Text style={styles.modalSaveText}>Save Task</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fafafa',
  },
  container: {
    flex: 1,
    backgroundColor: '#fafafa',
    paddingTop: 24,
    paddingHorizontal: 20,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#09090b',
    marginBottom: 24,
    letterSpacing: -0.8,
  },
  draftCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e4e4e7',
    borderLeftWidth: 4,
    borderLeftColor: '#09090b',
    shadowColor: '#000',
    shadowOpacity: 0.02,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  draftTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#71717a',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  draftText: {
    fontSize: 16,
    color: '#09090b',
    lineHeight: 24,
    marginBottom: 16,
  },
  draftActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  draftCopyButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#09090b',
    borderRadius: 8,
  },
  draftCopyButtonText: {
    fontSize: 14,
    color: '#fafafa',
    fontWeight: '600',
  },
  closeButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e4e4e7',
    borderRadius: 8,
  },
  closeButtonText: {
    fontSize: 14,
    color: '#09090b',
    fontWeight: '600',
  },
  listContent: {
    paddingBottom: 20,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 60,
  },
  emptyText: {
    color: '#09090b',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  emptySubText: {
    color: '#71717a',
    fontSize: 14,
  },
  taskCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e4e4e7',
    shadowColor: '#000',
    shadowOpacity: 0.02,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  taskInfo: {
    flex: 1,
    paddingRight: 12,
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#09090b',
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  taskDesc: {
    fontSize: 14,
    color: '#71717a',
    fontWeight: '500',
  },
  taskActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  copyButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e4e4e7',
    borderRadius: 6,
  },
  copyButtonText: {
    color: '#09090b',
    fontWeight: '600',
    fontSize: 12,
  },
  deleteButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 6,
  },
  deleteButtonText: {
    color: '#ef4444',
    fontWeight: '600',
    fontSize: 12,
  },
  actionContainer: {
    paddingTop: 16,
    paddingBottom: 24,
  },
  primaryButton: {
    backgroundColor: '#09090b',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  buttonText: {
    color: '#fafafa',
    fontSize: 16,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 10,
  },
  modalHeader: {
    fontSize: 20,
    fontWeight: '700',
    color: '#09090b',
    marginBottom: 20,
    letterSpacing: -0.4,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#09090b',
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#e4e4e7',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: '#09090b',
  },
  textArea: {
    height: 100,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 24,
    gap: 12,
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e4e4e7',
    alignItems: 'center',
  },
  modalCancelText: {
    color: '#09090b',
    fontWeight: '600',
    fontSize: 15,
  },
  modalSaveButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#09090b',
    alignItems: 'center',
  },
  modalSaveText: {
    color: '#fafafa',
    fontWeight: '600',
    fontSize: 15,
  },
  typeSelectorContainer: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
    marginBottom: 8,
  },
  typeButton: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e4e4e7',
    borderRadius: 8,
    alignItems: 'center',
  },
  typeButtonActive: {
    backgroundColor: '#09090b',
    borderColor: '#09090b',
  },
  typeButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#71717a',
  },
  typeButtonTextActive: {
    color: '#fafafa',
  }
});
