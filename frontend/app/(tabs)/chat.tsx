import { useRef, useState, useMemo, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  Modal,
  ActivityIndicator,
  Linking,
  AppState,
} from "react-native";
import { Image } from "expo-image";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import Feather from "@react-native-vector-icons/feather";
import { makeStyles, spacing, radius, useTheme } from "@/src/theme";
import { api, mediaSource } from "@/src/api";
import { usesNativeTabs } from "@/src/navigation";
import { haptic } from "@/src/haptics";
import { useToast } from "@/src/components/Toast";
import { MediaViewer, ViewerItem } from "@/src/components/MediaViewer";
import { formatUkTime } from "@/src/ukTime";

type Msg = {
  id: string;
  type: string;
  text?: string;
  sender_name?: string;
  is_mine: boolean;
  privacy: string;
  media_type?: string;
  media_path?: string;
  one_time: boolean;
  consumed: boolean;
  can_open: boolean;
  read_at?: string | null;

  // GIF fields
  gif_id?: string;
  gif_url?: string;
  gif_preview_url?: string;
  gif_title?: string;
};

type GifResult = {
  id: string;
  title?: string;
  images?: {
    fixed_width?: {
      url?: string;
      webp?: string;
    };
    fixed_width_small?: {
      url?: string;
      webp?: string;
    };
  };
};

const PRIVACY: { key: string; label: string; icon: any }[] = [
  { key: "none", label: "Normal", icon: "image" },
  { key: "no_save", label: "No saving", icon: "lock" },
  { key: "one_time", label: "View once", icon: "eye-off" },
];

function formatReadTime(iso: string) {
  try {
    return formatUkTime(iso);
  } catch {
    return "";
  }
}

export default function Chat() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const toast = useToast();
  const listRef = useRef<FlatList>(null);

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [privacy, setPrivacy] = useState("none");
  const [viewer, setViewer] = useState<{
    items: ViewerItem[];
    index: number;
  } | null>(null);

  // GIF state
  const [gifOpen, setGifOpen] = useState(false);
  const [gifQuery, setGifQuery] = useState("");
  const [gifResults, setGifResults] = useState<GifResult[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [gifSending, setGifSending] = useState(false);

  const giphyKey =
    process.env.EXPO_PUBLIC_GIPHY_API_KEY?.trim() || "";

  const meQ = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get("/couples/me"),
  });

  const msgsQ = useQuery<Msg[]>({
    queryKey: ["messages"],
    queryFn: () => api.get("/messages"),
    refetchInterval: 4000,
  });

  const messages = useMemo(
    () => msgsQ.data || [],
    [msgsQ.data],
  );

  const partnerName = meQ.data?.partner?.name;

  const viewable = useMemo(
    () =>
      messages.filter(
        (m) => m.type === "media" && !m.one_time,
      ),
    [messages],
  );

  const lastReadMineId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].is_mine && messages[i].read_at) {
        return messages[i].id;
      }
    }
    return null;
  }, [messages]);

  const [screenFocused, setScreenFocused] =
    useState(false);

  const [appActive, setAppActive] = useState(
    AppState.currentState === "active",
  );

  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);

      return () => setScreenFocused(false);
    }, []),
  );

  useEffect(() => {
    const sub = AppState.addEventListener(
      "change",
      (s) => setAppActive(s === "active"),
    );

    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!screenFocused || !appActive) return;

    const msgs = msgsQ.data || [];

    if (!msgs.length) return;

    if (
      !msgs.some(
        (m) => !m.is_mine && !m.read_at,
      )
    ) {
      return;
    }

    const last = msgs[msgs.length - 1];

    api
      .post("/messages/read", {
        through_id: last.id,
      })
      .then(() =>
        qc.invalidateQueries({
          queryKey: ["messages"],
        }),
      )
      .catch(() => {});
  }, [
    screenFocused,
    appActive,
    msgsQ.data,
    qc,
  ]);

  const sendText = async () => {
    const t = text.trim();

    if (!t || sending) return;

    setText("");
    setSending(true);

    haptic.light();

    try {
      await api.post("/messages/text", {
        text: t,
      });

      qc.invalidateQueries({
        queryKey: ["messages"],
      });
    } catch {
      toast.show("Message failed to send");
      setText(t);
    } finally {
      setSending(false);
    }
  };

  /*
   * ============================
   * GIPHY
   * ============================
   */

  const loadGifs = useCallback(
    async (query = "") => {
      if (!giphyKey) {
        toast.show(
          "GIPHY is not configured in this build",
        );
        return;
      }

      setGifLoading(true);

      try {
        const endpoint = query.trim()
          ? "https://api.giphy.com/v1/gifs/search"
          : "https://api.giphy.com/v1/gifs/trending";

        const params = new URLSearchParams({
          api_key: giphyKey,
          limit: "24",
          rating: "g",
          bundle: "messaging_non_clips",
        });

        if (query.trim()) {
          params.set(
            "q",
            query.trim().slice(0, 50),
          );
        }

        const response = await fetch(
          `${endpoint}?${params.toString()}`,
        );

        if (!response.ok) {
          throw new Error(
            `GIPHY request failed (${response.status})`,
          );
        }

        const json = await response.json();

        setGifResults(
          Array.isArray(json?.data)
            ? json.data
            : [],
        );
      } catch (error: any) {
        setGifResults([]);

        toast.show(
          error?.message ||
            "Could not load GIFs",
        );
      } finally {
        setGifLoading(false);
      }
    },
    [giphyKey, toast],
  );

  const openGifs = useCallback(() => {
    haptic.light();

    setGifOpen(true);

    if (!gifResults.length) {
      void loadGifs();
    }
  }, [
    gifResults.length,
    loadGifs,
  ]);

  const sendGif = useCallback(
    async (gif: GifResult) => {
      const gifUrl =
        gif.images?.fixed_width?.url ||
        gif.images?.fixed_width_small?.url;

      const previewUrl =
        gif.images?.fixed_width?.webp ||
        gif.images?.fixed_width_small?.webp ||
        gifUrl;

      if (!gifUrl) {
        toast.show("That GIF is unavailable");
        return;
      }

      if (gifSending) return;

      setGifSending(true);

      try {
        await api.post("/messages/gif", {
          gif_id: gif.id,
          gif_url: gifUrl,
          preview_url: previewUrl,
          title: gif.title || "",
        });

        haptic.success();

        setGifOpen(false);

        qc.invalidateQueries({
          queryKey: ["messages"],
        });
      } catch (error: any) {
        toast.show(
          error?.message ||
            "GIF failed to send",
        );
      } finally {
        setGifSending(false);
      }
    },
    [
      gifSending,
      qc,
      toast,
    ],
  );

  const pickAndSend = useCallback(
    async (
      mediaType: "image" | "video",
    ) => {
      setAttachOpen(false);

      const perm =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!perm.granted) {
        if (!perm.canAskAgain) {
          toast.show(
            "Enable photo access in Settings",
          );

          Linking.openSettings();
        } else {
          toast.show(
            "Photo access is needed to share",
          );
        }

        return;
      }

      const result =
        await ImagePicker.launchImageLibraryAsync(
          {
            mediaTypes:
              mediaType === "image"
                ? ["images"]
                : ["videos"],
            quality: 0.8,
            videoMaxDuration: 60,
          },
        );

      if (
        result.canceled ||
        !result.assets?.length
      ) {
        return;
      }

      const asset = result.assets[0];

      setSending(true);

      try {
        await api.uploadMedia(
          asset.uri,
          mediaType,
          privacy,
        );

        haptic.success();

        setPrivacy("none");

        qc.invalidateQueries({
          queryKey: ["messages"],
        });

        qc.invalidateQueries({
          queryKey: ["gallery"],
        });
      } catch (e: any) {
        toast.show(
          e?.message ||
            "Could not send media",
        );
      } finally {
        setSending(false);
      }
    },
    [privacy, qc, toast],
  );

  const captureAndSend = useCallback(
    async (
      mediaType: "image" | "video",
    ) => {
      setAttachOpen(false);

      const perm =
        await ImagePicker.requestCameraPermissionsAsync();

      if (!perm.granted) {
        if (!perm.canAskAgain) {
          toast.show(
            "Enable camera access in Settings",
          );

          Linking.openSettings();
        } else {
          toast.show(
            "Camera access is needed to snap a pic",
          );
        }

        return;
      }

      const result =
        await ImagePicker.launchCameraAsync(
          {
            mediaTypes:
              mediaType === "image"
                ? ["images"]
                : ["videos"],
            quality: 0.8,
            videoMaxDuration: 60,
          },
        );

      if (
        result.canceled ||
        !result.assets?.length
      ) {
        return;
      }

      const asset = result.assets[0];

      setSending(true);

      try {
        await api.uploadMedia(
          asset.uri,
          mediaType,
          privacy,
        );

        haptic.success();

        setPrivacy("none");

        qc.invalidateQueries({
          queryKey: ["messages"],
        });

        qc.invalidateQueries({
          queryKey: ["gallery"],
        });
      } catch (e: any) {
        toast.show(
          e?.message ||
            "Could not send media",
        );
      } finally {
        setSending(false);
      }
    },
    [privacy, qc, toast],
  );

  const openMedia = useCallback(
    async (m: Msg) => {
      if (m.one_time) {
        if (m.is_mine) return;

        if (
          m.consumed ||
          !m.can_open
        ) {
          toast.show(
            "This one-time photo is gone",
          );

          return;
        }

        try {
          await api.post(
            `/messages/${m.id}/open`,
            {},
          );

          haptic.light();

          setViewer({
            items: [
              {
                id: m.id,
                media_path:
                  m.media_path!,
                media_type:
                  m.media_type,
                privacy: "one_time",
              },
            ],
            index: 0,
          });
        } catch {
          toast.show(
            "This one-time photo is gone",
          );

          qc.invalidateQueries({
            queryKey: ["messages"],
          });
        }

        return;
      }

      const items = viewable.map(
        (v) => ({
          id: v.id,
          media_path:
            v.media_path!,
          media_type:
            v.media_type,
          privacy: v.privacy,
        }),
      );

      const idx = items.findIndex(
        (v) => v.id === m.id,
      );

      setViewer({
        items,
        index: Math.max(0, idx),
      });
    },
    [viewable, qc, toast],
  );

  const closeViewer = () => {
    setViewer(null);

    qc.invalidateQueries({
      queryKey: ["messages"],
    });
  };

  const renderItem = ({
    item,
  }: {
    item: Msg;
  }) => {
    const mine = item.is_mine;

    const showRead =
      item.id === lastReadMineId &&
      !!item.read_at;

    const readLabel = showRead ? (
      <Text
        style={styles.readReceipt}
        testID={`read-receipt-${item.id}`}
      >
        Read {formatReadTime(item.read_at!)}
      </Text>
    ) : null;

    if (item.type === "text") {
      return (
        <View
          style={[
            styles.row,
            mine
              ? styles.rowMine
              : styles.rowTheirs,
          ]}
        >
          <View
            style={[
              styles.bubble,
              mine
                ? styles.bubbleMine
                : styles.bubbleTheirs,
            ]}
          >
            <Text
              style={[
                styles.msgText,
                mine
                  ? styles.msgTextMine
                  : styles.msgTextTheirs,
              ]}
            >
              {item.text}
            </Text>
          </View>

          {readLabel}
        </View>
      );
    }

    // GIF message
    if (
      item.type === "gif" ||
      !!item.gif_url
    ) {
      return (
        <View
          style={[
            styles.row,
            mine
              ? styles.rowMine
              : styles.rowTheirs,
          ]}
        >
          <View
            style={[
              styles.gifBubble,
              mine
                ? styles.gifBubbleMine
                : styles.gifBubbleTheirs,
            ]}
          >
            {item.gif_url ? (
              <Image
                source={{
                  uri: item.gif_url,
                }}
                style={
                  styles.gifMessageImage
                }
                contentFit="cover"
              />
            ) : null}

            <View
              style={
                styles.gifAttributionRow
              }
            >
              <Text
                style={
                  styles.gifAttribution
                }
              >
                GIF
              </Text>

              <Text
                style={
                  styles.gifAttribution
                }
              >
                GIPHY
              </Text>
            </View>
          </View>

          {readLabel}
        </View>
      );
    }

    // media
    return (
      <View
        style={[
          styles.row,
          mine
            ? styles.rowMine
            : styles.rowTheirs,
        ]}
      >
        <MediaBubble
          item={item}
          mine={mine}
          onPress={() =>
            openMedia(item)
          }
        />

        {readLabel}
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <View
        style={[
          styles.header,
          {
            paddingTop:
              insets.top +
              spacing.sm,
          },
        ]}
      >
        <View style={styles.avatar}>
          <Text
            style={styles.avatarText}
          >
            {(partnerName || "?")
              .charAt(0)
              .toUpperCase()}
          </Text>
        </View>

        <View>
          <Text
            style={styles.headerName}
          >
            {partnerName ||
              "Your partner"}
          </Text>

          <Text
            style={styles.headerSub}
          >
            {partnerName
              ? "just the two of you"
              : "waiting to connect"}
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior="translate-with-padding"
        keyboardVerticalOffset={0}
      >
        {msgsQ.isLoading ? (
          <View
            style={styles.center}
          >
            <ActivityIndicator
              color={
                colors.brandPrimary
              }
            />
          </View>
        ) : messages.length === 0 ? (
          <View
            style={styles.center}
          >
            <Feather
              name="message-circle"
              size={40}
              color={
                colors.brandSecondary
              }
            />

            <Text
              style={styles.emptyText}
            >
              Say hello 👋
            </Text>

            <Text
              style={styles.emptySub}
            >
              Your private
              conversation starts
              here.
            </Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) =>
              m.id
            }
            renderItem={renderItem}
            contentContainerStyle={{
              padding: spacing.lg,
              paddingBottom:
                spacing.md,
            }}
            onContentSizeChange={() =>
              listRef.current?.scrollToEnd(
                {
                  animated: true,
                },
              )
            }
            showsVerticalScrollIndicator={
              false
            }
          />
        )}

        {/* GIF picker */}
        {gifOpen ? (
          <View
            style={styles.gifPanel}
          >
            <View
              style={styles.gifHeader}
            >
              <Text
                style={styles.gifTitle}
              >
                GIFs
              </Text>

              <Text
                style={
                  styles.gifPowered
                }
              >
                Powered by GIPHY
              </Text>

              <Pressable
                onPress={() =>
                  setGifOpen(false)
                }
                hitSlop={8}
              >
                <Feather
                  name="x"
                  size={20}
                  color={
                    colors.onSurfaceSecondary
                  }
                />
              </Pressable>
            </View>

            <View
              style={styles.gifSearchRow}
            >
              <TextInput
                value={gifQuery}
                onChangeText={
                  setGifQuery
                }
                onSubmitEditing={() =>
                  void loadGifs(
                    gifQuery,
                  )
                }
                placeholder="Search GIFs..."
                placeholderTextColor={
                  colors.muted
                }
                style={
                  styles.gifSearchInput
                }
                returnKeyType="search"
              />

              <Pressable
                style={
                  styles.gifSearchBtn
                }
                onPress={() =>
                  void loadGifs(
                    gifQuery,
                  )
                }
                disabled={gifLoading}
              >
                <Feather
                  name="search"
                  size={17}
                  color={
                    colors.onBrandPrimary
                  }
                />
              </Pressable>
            </View>

            {gifLoading ? (
              <View
                style={
                  styles.gifLoading
                }
              >
                <ActivityIndicator
                  color={
                    colors.brandPrimary
                  }
                />
              </View>
            ) : gifResults.length ? (
              <FlatList
                data={gifResults}
                keyExtractor={(gif) =>
                  gif.id
                }
                numColumns={3}
                style={styles.gifGrid}
                contentContainerStyle={
                  styles.gifGridContent
                }
                showsVerticalScrollIndicator={
                  false
                }
                renderItem={({
                  item: gif,
                }) => {
                  const uri =
                    gif.images
                      ?.fixed_width_small
                      ?.webp ||
                    gif.images
                      ?.fixed_width
                      ?.webp ||
                    gif.images
                      ?.fixed_width_small
                      ?.url ||
                    gif.images
                      ?.fixed_width
                      ?.url;

                  if (!uri) {
                    return null;
                  }

                  return (
                    <Pressable
                      style={
                        styles.gifTile
                      }
                      onPress={() =>
                        void sendGif(
                          gif,
                        )
                      }
                      disabled={
                        gifSending
                      }
                    >
                      <Image
                        source={{
                          uri,
                        }}
                        style={
                          styles.gifTileImage
                        }
                        contentFit="cover"
                      />
                    </Pressable>
                  );
                }}
              />
            ) : (
              <View
                style={
                  styles.gifEmpty
                }
              >
                <Text
                  style={
                    styles.gifEmptyText
                  }
                >
                  {giphyKey
                    ? "No GIFs found"
                    : "GIPHY is not configured"}
                </Text>
              </View>
            )}
          </View>
        ) : null}

        {/* Chat input */}
        <View
          style={[
            styles.inputBar,
            {
              paddingBottom:
                usesNativeTabs
                  ? insets.bottom
                  : spacing.sm,
            },
          ]}
        >
          <Pressable
            style={styles.attachBtn}
            onPress={() => {
              haptic.light();
              setAttachOpen(true);
            }}
            testID="attach-btn"
          >
            <Feather
              name="plus"
              size={22}
              color={
                colors.brandPrimary
              }
            />
          </Pressable>

          <TextInput
            testID="chat-input"
            style={styles.input}
            placeholder="Write something sweet..."
            placeholderTextColor={
              colors.muted
            }
            value={text}
            onChangeText={setText}
            multiline
          />

          {/* GIF button */}
          <Pressable
            style={[
              styles.gifBtn,
              gifOpen &&
                styles.gifBtnActive,
            ]}
            onPress={openGifs}
            disabled={
              sending ||
              gifSending
            }
            testID="gif-btn"
          >
            <Text
              style={[
                styles.gifBtnText,
                gifOpen &&
                  styles.gifBtnTextActive,
              ]}
            >
              GIF
            </Text>
          </Pressable>

          {/* Send */}
          <Pressable
            style={
              styles.sendBtn
            }
            onPress={sendText}
            disabled={
              sending ||
              !text.trim()
            }
            testID="send-btn"
          >
            <Feather
              name="send"
              size={18}
              color={
                colors.onBrandPrimary
              }
            />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* Attach sheet */}
      <Modal
        visible={attachOpen}
        transparent
        animationType="slide"
        onRequestClose={() =>
          setAttachOpen(false)
        }
      >
        <Pressable
          style={
            styles.sheetBackdrop
          }
          onPress={() =>
            setAttachOpen(false)
          }
        />

        <View
          style={[
            styles.sheet,
            {
              paddingBottom:
                insets.bottom +
                spacing.lg,
            },
          ]}
        >
          <View
            style={styles.grabber}
          />

          <Text
            style={styles.sheetTitle}
          >
            Share a photo or video
          </Text>

          <Text
            style={styles.sheetLabel}
          >
            Privacy
          </Text>

          <View
            style={styles.privacyRow}
          >
            {PRIVACY.map((p) => (
              <Pressable
                key={p.key}
                testID={`privacy-${p.key}`}
                style={[
                  styles.privacyChip,
                  privacy ===
                    p.key &&
                    styles.privacyChipActive,
                ]}
                onPress={() => {
                  setPrivacy(
                    p.key,
                  );
                  haptic.light();
                }}
              >
                <Feather
                  name={p.icon}
                  size={16}
                  color={
                    privacy ===
                    p.key
                      ? colors.onBrandPrimary
                      : colors.onSurfaceTertiary
                  }
                />

                <Text
                  style={[
                    styles.privacyText,
                    privacy ===
                      p.key &&
                      styles.privacyTextActive,
                  ]}
                >
                  {p.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text
            style={
              styles.privacyHint
            }
          >
            {privacy === "one_time"
              ? "Disappears right after your partner views it once."
              : privacy === "no_save"
              ? "Your partner can view it but can't save it."
              : "A normal photo that lives in your gallery."}
          </Text>

          <Text
            style={styles.sheetLabel}
          >
            Snap now
          </Text>

          <View
            style={styles.pickRow}
          >
            <Pressable
              style={styles.snapBtn}
              onPress={() =>
                captureAndSend(
                  "image",
                )
              }
              testID="capture-photo"
            >
              <Feather
                name="camera"
                size={22}
                color={
                  colors.onBrandPrimary
                }
              />

              <Text
                style={styles.snapText}
              >
                Photo
              </Text>
            </Pressable>

            <Pressable
              style={styles.snapBtn}
              onPress={() =>
                captureAndSend(
                  "video",
                )
              }
              testID="capture-video"
            >
              <Feather
                name="video"
                size={22}
                color={
                  colors.onBrandPrimary
                }
              />

              <Text
                style={styles.snapText}
              >
                Record
              </Text>
            </Pressable>
          </View>

          <Text
            style={[
              styles.sheetLabel,
              {
                marginTop:
                  spacing.lg,
              },
            ]}
          >
            From gallery
          </Text>

          <View
            style={styles.pickRow}
          >
            <Pressable
              style={styles.pickBtn}
              onPress={() =>
                pickAndSend(
                  "image",
                )
              }
              testID="pick-photo"
            >
              <Feather
                name="image"
                size={22}
                color={
                  colors.onBrandTertiary
                }
              />

              <Text
                style={styles.pickText}
              >
                Photo
              </Text>
            </Pressable>

            <Pressable
              style={styles.pickBtn}
              onPress={() =>
                pickAndSend(
                  "video",
                )
              }
              testID="pick-video"
            >
              <Feather
                name="video"
                size={22}
                color={
                  colors.onBrandTertiary
                }
              />

              <Text
                style={styles.pickText}
              >
                Video
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {viewer ? (
        <MediaViewer
          visible
          items={viewer.items}
          initialIndex={
            viewer.index
          }
          onClose={closeViewer}
        />
      ) : null}

      {sending ? (
        <View
          style={styles.uploading}
          testID="uploading-indicator"
        >
          <ActivityIndicator
            color={
              colors.onSurfaceInverse
            }
          />

          <Text
            style={
              styles.uploadingText
            }
          >
            Sending...
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function MediaBubble({
  item,
  mine,
  onPress,
}: {
  item: Msg;
  mine: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();

  if (item.one_time) {
    const gone =
      item.consumed ||
      (mine
        ? false
        : !item.can_open);

    const label = mine
      ? item.consumed
        ? "One-time • viewed"
        : "One-time photo sent"
      : gone
      ? "Opened • gone"
      : "Tap to view once";

    return (
      <Pressable
        testID={`media-onetime-${item.id}`}
        onPress={onPress}
        disabled={
          mine || gone
        }
        style={[
          styles.mediaBubble,
          styles.oneTimeCard,
          mine
            ? styles.bubbleMine
            : styles.bubbleTheirs,
        ]}
      >
        <Feather
          name={
            gone
              ? "eye-off"
              : "eye"
          }
          size={26}
          color={
            mine
              ? colors.onBrandPrimary
              : colors.onSurfaceSecondary
          }
        />

        <Text
          style={[
            styles.oneTimeText,
            {
              color: mine
                ? colors.onBrandPrimary
                : colors.onSurfaceSecondary,
            },
          ]}
        >
          {label}
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      testID={`media-${item.id}`}
      onPress={onPress}
      style={styles.mediaBubble}
    >
      <Image
        source={mediaSource(
          item.media_path!,
        )}
        style={styles.mediaImg}
        contentFit="cover"
        transition={200}
      />

      {item.media_type ===
      "video" ? (
        <View
          style={
            styles.playOverlay
          }
        >
          <Feather
            name="play"
            size={26}
            color="#FFFFFF"
          />
        </View>
      ) : null}

      {item.privacy ===
      "no_save" ? (
        <View
          style={
            styles.lockBadge
          }
        >
          <Feather
            name="lock"
            size={12}
            color="#FFFFFF"
          />
        </View>
      ) : null}

      {mine &&
      item.read_at ? (
        <View
          style={
            styles.seenBadge
          }
          testID={`media-seen-${item.id}`}
        >
          <Feather
            name="check"
            size={11}
            color="#FFFFFF"
          />

          <Text
            style={
              styles.seenText
            }
          >
            Seen
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  root: {
    flex: 1,
    backgroundColor: c.surface,
  },

  flex: {
    flex: 1,
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },

  emptyText: {
    fontFamily: "Fraunces",
    fontSize: 22,
    fontWeight: "700",
    color: c.onSurface,
    marginTop: spacing.md,
  },

  emptySub: {
    fontFamily: "Nunito",
    fontSize: 14,
    color: c.muted,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: c.surface,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
  },

  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },

  avatarText: {
    fontFamily: "Fraunces",
    fontSize: 18,
    fontWeight: "700",
    color: c.onBrandPrimary,
  },

  headerName: {
    fontFamily: "Fraunces",
    fontSize: 17,
    fontWeight: "700",
    color: c.onSurface,
  },

  headerSub: {
    fontFamily: "Nunito",
    fontSize: 12,
    color: c.muted,
  },

  row: {
    marginBottom: spacing.md,
    maxWidth: "82%",
  },

  rowMine: {
    alignSelf: "flex-end",
    alignItems: "flex-end",
  },

  rowTheirs: {
    alignSelf: "flex-start",
    alignItems: "flex-start",
  },

  bubble: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
  },

  bubbleMine: {
    backgroundColor: c.brandPrimary,
    borderBottomRightRadius: spacing.xs,
  },

  bubbleTheirs: {
    backgroundColor: c.surfaceSecondary,
    borderBottomLeftRadius: spacing.xs,
  },

  msgText: {
    fontFamily: "Nunito",
    fontSize: 15,
    lineHeight: 21,
  },

  msgTextMine: {
    color: c.onBrandPrimary,
  },

  msgTextTheirs: {
    color: c.onSurfaceSecondary,
  },

  mediaBubble: {
    borderRadius: radius.md,
    overflow: "hidden",
  },

  mediaImg: {
    width: 200,
    height: 240,
    borderRadius: radius.md,
    backgroundColor: c.surfaceSecondary,
  },

  playOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(0,0,0,0.25)",
  },

  lockBadge: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    backgroundColor:
      "rgba(0,0,0,0.55)",
    borderRadius: 999,
    padding: 6,
  },

  seenBadge: {
    position: "absolute",
    bottom: spacing.sm,
    right: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor:
      "rgba(0,0,0,0.6)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },

  seenText: {
    fontFamily: "Nunito",
    fontSize: 11,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  readReceipt: {
    fontFamily: "Nunito",
    fontSize: 11,
    color: c.muted,
    marginTop: 3,
    marginRight: spacing.xs,
  },

  oneTimeCard: {
    width: 200,
    height: 120,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },

  oneTimeText: {
    fontFamily: "Nunito",
    fontSize: 14,
    fontWeight: "700",
  },

  /*
   * ============================
   * GIF MESSAGE
   * ============================
   */

  gifBubble: {
    width: 230,
    borderRadius: radius.md,
    overflow: "hidden",
    padding: 3,
  },

  gifBubbleMine: {
    backgroundColor: c.brandPrimary,
  },

  gifBubbleTheirs: {
    backgroundColor: c.surfaceSecondary,
  },

  gifMessageImage: {
    width: 224,
    height: 170,
    borderRadius: radius.sm,
    backgroundColor: c.surfaceSecondary,
  },

  gifAttributionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 5,
    paddingTop: 2,
    paddingBottom: 1,
  },

  gifAttribution: {
    fontFamily: "Nunito",
    fontSize: 9,
    fontWeight: "700",
    color: c.muted,
  },

  /*
   * ============================
   * GIF PICKER
   * ============================
   */

  gifPanel: {
    height: 330,
    backgroundColor: c.surface,
    borderTopWidth: 1,
    borderTopColor: c.divider,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },

  gifHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm,
  },

  gifTitle: {
    fontFamily: "Fraunces",
    fontSize: 18,
    fontWeight: "700",
    color: c.onSurface,
  },

  gifPowered: {
    flex: 1,
    fontFamily: "Nunito",
    fontSize: 10,
    color: c.muted,
  },

  gifSearchRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },

  gifSearchInput: {
    flex: 1,
    height: 42,
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontFamily: "Nunito",
    fontSize: 14,
    color: c.onSurface,
  },

  gifSearchBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.brandPrimary,
  },

  gifLoading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  gifGrid: {
    flex: 1,
  },

  gifGridContent: {
    paddingBottom: spacing.sm,
  },

  gifTile: {
    width: "32%",
    aspectRatio: 1.25,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
    overflow: "hidden",
    borderRadius: radius.sm,
    backgroundColor: c.surfaceSecondary,
  },

  gifTileImage: {
    width: "100%",
    height: "100%",
  },

  gifEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  gifEmptyText: {
    fontFamily: "Nunito",
    fontSize: 13,
    color: c.muted,
  },

  /*
   * ============================
   * CHAT BAR
   * ============================
   */

  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: c.surface,
    borderTopWidth: 1,
    borderTopColor: c.divider,
  },

  attachBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.brandTertiary,
  },

  input: {
    flex: 1,
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    fontFamily: "Nunito",
    fontSize: 15,
    color: c.onSurface,
    maxHeight: 120,
    minHeight: 44,
  },

  gifBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.brandTertiary,
  },

  gifBtnActive: {
    backgroundColor: c.brandPrimary,
  },

  gifBtnText: {
    fontFamily: "Nunito",
    fontSize: 11,
    fontWeight: "900",
    color: c.brandPrimary,
  },

  gifBtnTextActive: {
    color: c.onBrandPrimary,
  },

  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.brandPrimary,
  },

  sheetBackdrop: {
    flex: 1,
    backgroundColor:
      "rgba(0,0,0,0.35)",
  },

  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },

  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.borderStrong,
    marginBottom: spacing.lg,
  },

  sheetTitle: {
    fontFamily: "Fraunces",
    fontSize: 20,
    fontWeight: "700",
    color: c.onSurface,
    marginBottom: spacing.lg,
  },

  sheetLabel: {
    fontFamily: "Nunito",
    fontSize: 13,
    fontWeight: "700",
    color: c.onSurfaceTertiary,
    marginBottom: spacing.sm,
  },

  privacyRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },

  privacyChip: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1.5,
    borderColor: c.border,
  },

  privacyChipActive: {
    backgroundColor: c.brandPrimary,
    borderColor: c.brandPrimary,
  },

  privacyText: {
    fontFamily: "Nunito",
    fontSize: 12,
    fontWeight: "600",
    color: c.onSurfaceTertiary,
  },

  privacyTextActive: {
    color: c.onBrandPrimary,
  },

  privacyHint: {
    fontFamily: "Nunito",
    fontSize: 13,
    color: c.muted,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },

  pickRow: {
    flexDirection: "row",
    gap: spacing.md,
  },

  pickBtn: {
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: c.brandTertiary,
  },

  pickText: {
    fontFamily: "Nunito",
    fontSize: 15,
    fontWeight: "700",
    color: c.onBrandTertiary,
  },

  snapBtn: {
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: c.brandPrimary,
  },

  snapText: {
    fontFamily: "Nunito",
    fontSize: 15,
    fontWeight: "700",
    color: c.onBrandPrimary,
  },

  uploading: {
    position: "absolute",
    top: 100,
    alignSelf: "center",
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    backgroundColor: c.surfaceInverse,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: 999,
  },

  uploadingText: {
    fontFamily: "Nunito",
    fontSize: 14,
    color: c.onSurfaceInverse,
  },
}));
