import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather";
import { format, startOfWeek, addDays, parseISO } from "date-fns";
import * as SecureStore from "expo-secure-store";

import { makeStyles, spacing, radius, useTheme } from "@/src/theme";
import { ukTodayISO } from "@/src/ukTime";

type TodoItem = {
  id: string;
  text: string;
  completed: boolean;
  created_at: string;
};

function weekStartISO(todayISO: string) {
  const d = parseISO(todayISO);
  const s = startOfWeek(d, { weekStartsOn: 1 });
  return format(s, "yyyy-MM-dd");
}

export default function Calendar() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const todayISO = ukTodayISO();
  const weekStart = useMemo(() => weekStartISO(todayISO), [todayISO]);
  const weekEnd = useMemo(
    () => format(addDays(parseISO(weekStart), 6), "d MMM"),
    [weekStart],
  );
  const storageKey = `weekly-todo:${weekStart}`;

  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<TodoItem[]>([]);
  const [text, setText] = useState("");

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const saved = await SecureStore.getItemAsync(storageKey);
        if (mounted) {
          setTasks(saved ? JSON.parse(saved) : []);
        }
      } catch (error) {
        console.warn("Could not load weekly to-do list", error);
        if (mounted) setTasks([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [storageKey]);

  const saveTasks = async (next: TodoItem[]) => {
    setTasks(next);
    try {
      await SecureStore.setItemAsync(storageKey, JSON.stringify(next));
    } catch (error) {
      console.warn("Could not save weekly to-do list", error);
    }
  };

  const addTask = async () => {
    const value = text.trim();
    if (!value) return;

    const item: TodoItem = {
      id: `${Date.now()}`,
      text: value,
      completed: false,
      created_at: new Date().toISOString(),
    };

    setText("");
    await saveTasks([item, ...tasks]);
  };

  const toggleTask = async (id: string) => {
    const next = tasks.map((task) =>
      task.id === id ? { ...task, completed: !task.completed } : task,
    );
    await saveTasks(next);
  };

  const removeTask = async (id: string) => {
    const next = tasks.filter((task) => task.id !== id);
    await saveTasks(next);
  };

  const clearWeek = async () => {
    await saveTasks([]);
  };

  const renderItem = ({ item }: { item: TodoItem }) => (
    <View style={styles.card} testID={`todo-${item.id}`}>
      <Pressable onPress={() => toggleTask(item.id)} style={styles.check} testID={`todo-toggle-${item.id}`}>
        <View style={[styles.checkBox, item.completed && styles.checkedBox]}>
          {item.completed ? <Feather name="check" size={14} color={colors.onBrandPrimary} /> : null}
        </View>
      </Pressable>

      <View style={styles.cardBody}>
        <Text style={[styles.taskText, item.completed && styles.taskCompleted]}>{item.text}</Text>
      </View>

      <Pressable onPress={() => removeTask(item.id)} style={styles.deleteBtn} testID={`todo-delete-${item.id}`}>
        <Feather name="trash-2" size={18} color={colors.muted} />
      </Pressable>
    </View>
  );

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
        <Text style={styles.hello}>weekly</Text>
        <Text style={styles.title}>To do</Text>
        <Text style={styles.sub}>
          Week of {weekStart} to {weekEnd}
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 120 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={() => (
            <View style={styles.emptyWrap}>
              <Feather name="clipboard" size={54} color={colors.muted} />
              <Text style={styles.emptyTitle}>Nothing planned this week</Text>
              <Text style={styles.emptySub}>Add a task. It will reset automatically when the week changes.</Text>
            </View>
          )}
        />
      )}

      <View style={[styles.composer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <TextInput
          testID="todo-input"
          style={styles.input}
          placeholder="Add a task"
          placeholderTextColor={colors.muted}
          value={text}
          onChangeText={setText}
          onSubmitEditing={addTask}
          returnKeyType="done"
        />

        <Pressable style={styles.addBtn} onPress={addTask} testID="todo-add-btn">
          <Feather name="plus" size={18} color={colors.onBrandPrimary} />
        </Pressable>

        <Pressable style={styles.clearBtn} onPress={clearWeek} testID="todo-clear-btn">
          <Text style={styles.clearText}>Clear</Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
  hello: { fontFamily: "Caveat", fontSize: 22, color: c.brandPrimary },
  title: { fontFamily: "Fraunces", fontSize: 30, fontWeight: "700", color: c.onSurface },
  sub: { fontFamily: "Nunito", fontSize: 13, color: c.muted, marginTop: spacing.xs },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: spacing.xl, gap: spacing.sm },
  emptyTitle: { fontFamily: "Fraunces", fontSize: 20, fontWeight: "700", color: c.onSurface },
  emptySub: { fontFamily: "Nunito", fontSize: 14, color: c.muted, textAlign: "center" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: c.border,
    overflow: "hidden",
  },
  check: { padding: spacing.md },
  checkBox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkedBox: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  cardBody: { flex: 1, paddingVertical: spacing.md, paddingRight: spacing.lg },
  taskText: { fontFamily: "Fraunces", fontSize: 17, fontWeight: "700", color: c.onSurface },
  taskCompleted: { textDecorationLine: "line-through", color: c.muted },
  deleteBtn: { padding: spacing.md },
  composer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: c.surface,
  },
  input: {
    flex: 1,
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.lg,
    fontFamily: "Nunito",
    fontSize: 16,
    color: c.onSurface,
  },
  addBtn: {
    backgroundColor: c.brandPrimary,
    borderRadius: radius.md,
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  clearBtn: { paddingHorizontal: spacing.sm, paddingVertical: spacing.md },
  clearText: { fontFamily: "Nunito", fontSize: 13, fontWeight: "700", color: c.muted },
}));
