import { StatusBar } from "expo-status-bar";
import { Video } from "expo-av";
import * as SecureStore from "expo-secure-store";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as WebBrowser from "expo-web-browser";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

const STORAGE_CONFIG = "sfd_mobile_config";
const STORAGE_AUTOMATION = "sfd_mobile_automation";
const STORAGE_LAST_RUN = "sfd_mobile_last_run";
const KEY_OPENAI = "sfd_openai_key";
const KEY_ELEVEN = "sfd_elevenlabs_key";

const DEFAULT_CONFIG = {
  backendUrl: "",
  defaultPrompt:
    "Write a 30 second motivational speech for YouTube Shorts. Hook the viewer in the first sentence. Use simple powerful language.",
  defaultVoice: "alloy",
  defaultTitle: "Daily Motivation",
  defaultDescription:
    "Daily motivational shorts.\n\nSubscribe for more success mindset content.\n\n#motivation #success #discipline",
  defaultTags: ["motivation", "success", "discipline"],
  videosPerDay: 1,
  uploadTime: "09:00",
  openaiModel: "gpt-4o-mini",
  openaiBaseUrl: "",
  autoMetadata: true,
  channelContext: "motivational shorts",
  analysisVideoCount: 30,
  maxDuration: 0,
  subtitleStyle: { fontSize: 64, outline: 4 },
  defaultMusic: "",
  musicVolume: 0.18,
};

const TAB_LIST = [
  { key: "home", label: "Home" },
  { key: "create", label: "Create" },
  { key: "library", label: "Library" },
  { key: "insights", label: "Insights" },
  { key: "automation", label: "Automation" },
  { key: "settings", label: "Settings" },
];

const normalizeConfig = (config) => ({
  ...DEFAULT_CONFIG,
  ...config,
  autoMetadata: config?.autoMetadata !== false,
  channelContext: config?.channelContext || DEFAULT_CONFIG.channelContext,
  analysisVideoCount: Number(config?.analysisVideoCount) || DEFAULT_CONFIG.analysisVideoCount,
  defaultTags: Array.isArray(config?.defaultTags) ? config.defaultTags : DEFAULT_CONFIG.defaultTags,
  subtitleStyle: {
    fontSize: Number(config?.subtitleStyle?.fontSize) || DEFAULT_CONFIG.subtitleStyle.fontSize,
    outline: Number(config?.subtitleStyle?.outline) || DEFAULT_CONFIG.subtitleStyle.outline,
  },
  videosPerDay: Number(config?.videosPerDay) || DEFAULT_CONFIG.videosPerDay,
  maxDuration: Number(config?.maxDuration) || 0,
  musicVolume: typeof config?.musicVolume === "number" ? config.musicVolume : DEFAULT_CONFIG.musicVolume,
});

function useApiBase(config) {
  return useMemo(() => {
    const raw = config.backendUrl || "";
    return raw.replace(/\/+$/, "");
  }, [config.backendUrl]);
}

export default function App() {
  const [activeTab, setActiveTab] = useState("home");
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [openaiKey, setOpenaiKey] = useState("");
  const [elevenLabsKey, setElevenLabsKey] = useState("");
  const [baseVideos, setBaseVideos] = useState([]);
  const [selectedBaseVideo, setSelectedBaseVideo] = useState("");
  const [musicTracks, setMusicTracks] = useState([]);
  const [selectedMusic, setSelectedMusic] = useState("");
  const [history, setHistory] = useState([]);
  const [script, setScript] = useState("");
  const [promptOverride, setPromptOverride] = useState("");
  const [titleOverride, setTitleOverride] = useState("");
  const [descriptionOverride, setDescriptionOverride] = useState("");
  const [tagsOverride, setTagsOverride] = useState("");
  const [voiceFile, setVoiceFile] = useState("");
  const [videoFile, setVideoFile] = useState("");
  const [status, setStatus] = useState("");
  const [metadataStatus, setMetadataStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [automationEnabled, setAutomationEnabled] = useState(false);
  const [automationUpload, setAutomationUpload] = useState(false);
  const [youtubeStatus, setYoutubeStatus] = useState("Not connected");
  const [analysisStatus, setAnalysisStatus] = useState("");
  const [analysisReport, setAnalysisReport] = useState("");
  const [analysisChannelId, setAnalysisChannelId] = useState("");
  const [analysisVideoCount, setAnalysisVideoCount] = useState("30");
  const [analysisChannelContext, setAnalysisChannelContext] = useState("");

  const apiBase = useApiBase(config);

  useEffect(() => {
    (async () => {
      const stored = await AsyncStorage.getItem(STORAGE_CONFIG);
      if (stored) {
        setConfig(normalizeConfig(JSON.parse(stored)));
      }
      const savedOpenai = await SecureStore.getItemAsync(KEY_OPENAI);
      const savedEleven = await SecureStore.getItemAsync(KEY_ELEVEN);
      if (savedOpenai) setOpenaiKey(savedOpenai);
      if (savedEleven) setElevenLabsKey(savedEleven);

      const automationRaw = await AsyncStorage.getItem(STORAGE_AUTOMATION);
      if (automationRaw) {
        const data = JSON.parse(automationRaw);
        setAutomationEnabled(Boolean(data.enabled));
        setAutomationUpload(Boolean(data.upload));
      }
    })();
  }, []);

  useEffect(() => {
    if (!apiBase) return;
    refreshAll();
  }, [apiBase]);

  useEffect(() => {
    setAnalysisVideoCount(String(config.analysisVideoCount || 30));
    setAnalysisChannelContext(config.channelContext || "motivational shorts");
  }, [config.analysisVideoCount, config.channelContext]);

  useEffect(() => {
    if (!automationEnabled) return;
    const timer = setInterval(() => runAutomationIfScheduled(), 30000);
    return () => clearInterval(timer);
  }, [automationEnabled, config, openaiKey, elevenLabsKey, automationUpload]);

  const refreshAll = async () => {
    await Promise.all([refreshBaseVideos(), refreshMusic(), refreshHistory(), checkYoutube()]);
  };

  const apiFetch = async (path, options = {}) => {
    if (!apiBase) throw new Error("Set backend URL in Settings.");
    const res = await fetch(`${apiBase}${path}`, options);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(body || res.statusText);
    }
    return res.json();
  };

  const saveConfig = async () => {
    const clean = normalizeConfig(config);
    setConfig(clean);
    await AsyncStorage.setItem(STORAGE_CONFIG, JSON.stringify(clean));
    if (clean.backendUrl) {
      try {
        await apiFetch("/api/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(clean),
        });
      } catch (err) {
        console.error(err);
      }
    }
    setStatus("Settings saved locally.");
  };

  const saveSecrets = async () => {
    if (openaiKey) await SecureStore.setItemAsync(KEY_OPENAI, openaiKey);
    if (elevenLabsKey) await SecureStore.setItemAsync(KEY_ELEVEN, elevenLabsKey);
    setStatus("API keys saved securely.");
  };

  const refreshBaseVideos = async () => {
    try {
      const data = await apiFetch("/api/base/list");
      const videos = data.videos || [];
      setBaseVideos(videos);
      if (!selectedBaseVideo && videos.length) {
        setSelectedBaseVideo(videos[0]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const refreshMusic = async () => {
    try {
      const data = await apiFetch("/api/music/list");
      const tracks = data.tracks || [];
      setMusicTracks(tracks);
      if (!selectedMusic && tracks.length) {
        const preferred = config.defaultMusic || tracks[0];
        setSelectedMusic(preferred);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const refreshHistory = async () => {
    try {
      const data = await apiFetch("/api/history");
      setHistory(data.history || []);
    } catch (err) {
      console.error(err);
    }
  };

  const uploadFile = async (uri, endpoint) => {
    setLoading(true);
    try {
      const result = await FileSystem.uploadAsync(`${apiBase}${endpoint}`, uri, {
        fieldName: "file",
        httpMethod: "POST",
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      });
      if (result.status !== 200) {
        throw new Error(result.body || "Upload failed");
      }
      return JSON.parse(result.body);
    } finally {
      setLoading(false);
    }
  };

  const handleUploadBase = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission required", "Please allow photo library access to upload videos.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality: 1,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset?.uri) return;
    try {
      await uploadFile(asset.uri, "/api/base/upload");
      setStatus("Base video uploaded.");
      await refreshBaseVideos();
    } catch (err) {
      setStatus(err.message || "Upload failed.");
    }
  };

  const handleUploadMusic = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: "audio/*" });
    if (result.canceled) return;
    const file = result.assets?.[0];
    if (!file?.uri) return;
    try {
      await uploadFile(file.uri, "/api/music/upload");
      setStatus("Music uploaded.");
      await refreshMusic();
    } catch (err) {
      setStatus(err.message || "Music upload failed.");
    }
  };

  const handleGenerateScript = async () => {
    if (!openaiKey) {
      setStatus("Add your OpenAI key in Settings.");
      return;
    }
    setLoading(true);
    setStatus("Generating script...");
    try {
      const data = await apiFetch("/api/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptOverride?.trim() || config.defaultPrompt,
          apiKey: openaiKey,
          baseUrl: config.openaiBaseUrl,
          model: config.openaiModel,
        }),
      });
      setScript(data.script || "");
      setStatus("Script generated.");
      setMetadataStatus("");
    } catch (err) {
      setStatus(err.message || "Script generation failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateMetadata = async () => {
    if (!script.trim()) {
      setMetadataStatus("Generate a script first.");
      return;
    }
    if (!openaiKey) {
      setMetadataStatus("Add your OpenAI key in Settings.");
      return;
    }
    setLoading(true);
    setMetadataStatus("Generating metadata...");
    try {
      const data = await apiFetch("/api/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script,
          apiKey: openaiKey,
          baseUrl: config.openaiBaseUrl,
          model: config.openaiModel,
          channelContext: config.channelContext,
        }),
      });
      if (data.title) setTitleOverride(data.title);
      if (data.description) setDescriptionOverride(data.description);
      if (Array.isArray(data.tags)) setTagsOverride(data.tags.join(", "));
      setMetadataStatus("Metadata generated.");
    } catch (err) {
      setMetadataStatus(err.message || "Metadata generation failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateVoice = async () => {
    if (!script.trim()) {
      setStatus("Generate a script first.");
      return;
    }
    if (!elevenLabsKey) {
      setStatus("Add your ElevenLabs key in Settings.");
      return;
    }
    setLoading(true);
    setStatus("Generating voice...");
    try {
      const data = await apiFetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: script,
          voice: config.defaultVoice,
          elevenLabsApiKey: elevenLabsKey,
        }),
      });
      setVoiceFile(data.file || "");
      setStatus("Voice generated.");
    } catch (err) {
      setStatus(err.message || "Voice generation failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateVideo = async () => {
    if (!baseVideos.length) {
      setStatus("Upload at least one base video.");
      return;
    }
    if (!voiceFile) {
      setStatus("Generate voice first.");
      return;
    }
    setLoading(true);
    setStatus("Generating video...");
    try {
      const data = await apiFetch("/api/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseVideo: selectedBaseVideo || baseVideos[0],
          voiceFile,
          script,
          title: titleOverride?.trim() || config.defaultTitle,
          maxDuration: config.maxDuration,
          musicFile: selectedMusic || config.defaultMusic,
          subtitleStyle: config.subtitleStyle,
          musicVolume: config.musicVolume,
        }),
      });
      setVideoFile(data.file || "");
      setStatus("Video generated.");
      await refreshHistory();
    } catch (err) {
      setStatus(err.message || "Video generation failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (fileName) => {
    if (!fileName) return;
    const url = `${apiBase}/uploads/generated/${fileName}`;
    const localPath = `${FileSystem.cacheDirectory}${fileName}`;
    try {
      const result = await FileSystem.downloadAsync(url, localPath);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri);
      } else {
        Alert.alert("Downloaded", result.uri);
      }
    } catch (err) {
      setStatus(err.message || "Download failed.");
    }
  };

  const handleConnectYoutube = async () => {
    try {
      const data = await apiFetch("/api/youtube/auth-url");
      if (data.url) {
        await WebBrowser.openBrowserAsync(data.url);
        setTimeout(checkYoutube, 3000);
      }
    } catch (err) {
      setStatus("YouTube connect failed.");
    }
  };

  const checkYoutube = async () => {
    try {
      const tokens = await apiFetch("/api/youtube/tokens");
      setYoutubeStatus(tokens.access_token ? "Connected" : "Not connected");
    } catch (err) {
      setYoutubeStatus("Not connected");
    }
  };

  const handleAnalyzeChannel = async () => {
    if (!openaiKey) {
      setAnalysisStatus("Add your OpenAI key in Settings.");
      return;
    }
    setLoading(true);
    setAnalysisStatus("Analyzing channel...");
    try {
      const data = await apiFetch("/api/channel/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: openaiKey,
          baseUrl: config.openaiBaseUrl,
          model: config.openaiModel,
          channelId: analysisChannelId.trim(),
          channelContext: analysisChannelContext || config.channelContext,
          maxVideos: Number(analysisVideoCount) || 30,
        }),
      });
      setAnalysisReport(data.report || "No report returned.");
      setAnalysisStatus("Analysis complete.");
    } catch (err) {
      setAnalysisStatus(err.message || "Analysis failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleUploadYoutube = async () => {
    if (!videoFile) {
      setStatus("Generate a video first.");
      return;
    }
    setLoading(true);
    setStatus("Uploading to YouTube...");
    try {
      const tokens = await apiFetch("/api/youtube/tokens");
      if (!tokens.access_token) {
        setStatus("Connect YouTube in Settings.");
        return;
      }
      const tags = (tagsOverride || "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      await apiFetch("/api/youtube/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          videoFile,
          title: titleOverride?.trim() || config.defaultTitle,
          description: descriptionOverride?.trim() || config.defaultDescription,
          tags: tags.length ? tags : config.defaultTags,
        }),
      });
      setStatus("Uploaded to YouTube.");
      await refreshHistory();
    } catch (err) {
      setStatus(err.message || "Upload failed.");
    } finally {
      setLoading(false);
    }
  };

  const runAutomation = async () => {
    if (!openaiKey || !elevenLabsKey) {
      setStatus("Add OpenAI + ElevenLabs keys in Settings.");
      return;
    }
    setLoading(true);
    setStatus("Running automation...");
    try {
      const result = await apiFetch("/api/automation/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openaiKey,
          openaiBaseUrl: config.openaiBaseUrl,
          openaiModel: config.openaiModel,
          elevenLabsKey,
          voice: config.defaultVoice,
          upload: automationUpload,
          maxDuration: config.maxDuration,
          musicFile: config.defaultMusic,
        }),
      });
      setStatus(`Automation complete. Generated ${result.results?.length || 0} videos.`);
      await AsyncStorage.setItem(STORAGE_LAST_RUN, getDateKey());
      await refreshHistory();
    } catch (err) {
      setStatus(err.message || "Automation failed.");
    } finally {
      setLoading(false);
    }
  };

  const runAutomationIfScheduled = async () => {
    if (!automationEnabled) return;
    const now = new Date();
    const [hours, minutes] = (config.uploadTime || "09:00").split(":").map(Number);
    const scheduled = new Date(now);
    scheduled.setHours(hours, minutes, 0, 0);
    const lastRun = await AsyncStorage.getItem(STORAGE_LAST_RUN);

    if (now >= scheduled && lastRun !== getDateKey()) {
      await runAutomation();
    }
  };

  const getDateKey = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const toggleAutomation = async (enabled) => {
    setAutomationEnabled(enabled);
    await AsyncStorage.setItem(STORAGE_AUTOMATION, JSON.stringify({ enabled, upload: automationUpload }));
  };

  const toggleAutomationUpload = async (enabled) => {
    setAutomationUpload(enabled);
    await AsyncStorage.setItem(STORAGE_AUTOMATION, JSON.stringify({ enabled: automationEnabled, upload: enabled }));
  };

  const renderTabs = () => (
    <View style={styles.tabRow}>
      {TAB_LIST.map((tab) => (
        <Pressable
          key={tab.key}
          style={[styles.tabButton, activeTab === tab.key && styles.tabButtonActive]}
          onPress={() => setActiveTab(tab.key)}
        >
          <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.title}>Shorts Factory Daily</Text>
        <Text style={styles.subtitle}>Mobile Studio for Daily Shorts</Text>
      </View>
      {renderTabs()}
      <ScrollView contentContainerStyle={styles.container}>
        {loading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color="#d14b26" />
            <Text style={styles.status}>{status || "Working..."}</Text>
          </View>
        )}
        {!loading && status ? <Text style={styles.status}>{status}</Text> : null}

        {activeTab === "home" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Quick Start</Text>
            <Text style={styles.text}>1. Set backend URL + API keys in Settings.</Text>
            <Text style={styles.text}>2. Upload 1-3 base videos in Library.</Text>
            <Text style={styles.text}>3. Create your short and upload to YouTube.</Text>
            <Pressable style={styles.button} onPress={refreshAll}>
              <Text style={styles.buttonText}>Refresh Status</Text>
            </Pressable>
            <Text style={styles.text}>YouTube: {youtubeStatus}</Text>
          </View>
        )}

        {activeTab === "create" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Create</Text>
            <Text style={styles.label}>Script Prompt</Text>
            <TextInput
              style={styles.textArea}
              multiline
              value={promptOverride}
              onChangeText={setPromptOverride}
              placeholder={config.defaultPrompt}
            />
            <Pressable style={styles.button} onPress={handleGenerateScript}>
              <Text style={styles.buttonText}>Generate Script</Text>
            </Pressable>
            <TextInput
              style={styles.textArea}
              multiline
              value={script}
              onChangeText={setScript}
              placeholder="Script will appear here"
            />
            <Pressable style={styles.secondaryButton} onPress={handleGenerateMetadata}>
              <Text style={styles.secondaryText}>Generate Title / Description / Tags</Text>
            </Pressable>
            {metadataStatus ? <Text style={styles.status}>{metadataStatus}</Text> : null}
            <Text style={styles.label}>Base Video</Text>
            {baseVideos.length ? (
              baseVideos.map((video) => (
                <Pressable
                  key={video}
                  style={[styles.chip, selectedBaseVideo === video && styles.chipActive]}
                  onPress={() => setSelectedBaseVideo(video)}
                >
                  <Text style={[styles.chipText, selectedBaseVideo === video && styles.chipTextActive]}>
                    {video}
                  </Text>
                </Pressable>
              ))
            ) : (
              <Text style={styles.text}>No base videos uploaded yet.</Text>
            )}
            <Text style={styles.label}>Title</Text>
            <TextInput
              style={styles.input}
              value={titleOverride}
              onChangeText={setTitleOverride}
              placeholder={config.defaultTitle}
            />
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={styles.textArea}
              multiline
              value={descriptionOverride}
              onChangeText={setDescriptionOverride}
              placeholder={config.defaultDescription}
            />
            <Text style={styles.label}>Tags (comma separated)</Text>
            <TextInput
              style={styles.input}
              value={tagsOverride}
              onChangeText={setTagsOverride}
              placeholder={config.defaultTags.join(", ")}
            />
            <Pressable style={styles.button} onPress={handleGenerateVoice}>
              <Text style={styles.buttonText}>Generate Voice</Text>
            </Pressable>
            <Text style={styles.label}>Background Music</Text>
            {musicTracks.length ? (
              musicTracks.map((track) => (
                <Pressable
                  key={track}
                  style={[styles.chip, selectedMusic === track && styles.chipActive]}
                  onPress={() => setSelectedMusic(track)}
                >
                  <Text style={[styles.chipText, selectedMusic === track && styles.chipTextActive]}>{track}</Text>
                </Pressable>
              ))
            ) : (
              <Text style={styles.text}>No music uploaded yet.</Text>
            )}
            <Pressable style={styles.button} onPress={handleGenerateVideo}>
              <Text style={styles.buttonText}>Generate Video</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={handleUploadYoutube}>
              <Text style={styles.secondaryText}>Upload to YouTube</Text>
            </Pressable>
            {videoFile ? (
              <>
                <View style={styles.videoPreview}>
                  <Video
                    source={{ uri: `${apiBase}/uploads/generated/${videoFile}` }}
                    useNativeControls
                    resizeMode="cover"
                    style={styles.video}
                  />
                </View>
                <Pressable style={styles.secondaryButton} onPress={() => handleDownload(videoFile)}>
                  <Text style={styles.secondaryText}>Download / Share Video</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        )}

        {activeTab === "library" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Library</Text>
            <Pressable style={styles.button} onPress={handleUploadBase}>
              <Text style={styles.buttonText}>Upload Base Video</Text>
            </Pressable>
            <Text style={styles.text}>Tap a base video to select it.</Text>
            {baseVideos.length ? (
              baseVideos.map((video) => (
                <Pressable
                  key={video}
                  style={[styles.chip, selectedBaseVideo === video && styles.chipActive]}
                  onPress={() => setSelectedBaseVideo(video)}
                >
                  <Text style={[styles.chipText, selectedBaseVideo === video && styles.chipTextActive]}>
                    {video}
                  </Text>
                </Pressable>
              ))
            ) : (
              <Text style={styles.text}>No base videos uploaded yet.</Text>
            )}
            <Pressable style={styles.secondaryButton} onPress={handleUploadMusic}>
              <Text style={styles.secondaryText}>Upload Background Music</Text>
            </Pressable>
            <Text style={styles.text}>Music tracks: {musicTracks.join(", ") || "None"}</Text>
            <Text style={styles.cardTitle}>History</Text>
            {history.slice(0, 10).map((item) => (
              <View key={item.id} style={styles.historyRow}>
                <Text style={styles.text}>{item.title}</Text>
                <Pressable style={styles.link} onPress={() => handleDownload(item.file)}>
                  <Text style={styles.linkText}>Download</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {activeTab === "insights" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Channel Insights</Text>
            <Text style={styles.text}>Connect YouTube in Settings first.</Text>
            <Text style={styles.label}>Channel ID (optional)</Text>
            <TextInput
              style={styles.input}
              value={analysisChannelId}
              onChangeText={setAnalysisChannelId}
              placeholder="UC..."
            />
            <Text style={styles.label}>Videos to analyze</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={analysisVideoCount}
              onChangeText={setAnalysisVideoCount}
              placeholder="30"
            />
            <Text style={styles.label}>Channel context</Text>
            <TextInput
              style={styles.input}
              value={analysisChannelContext}
              onChangeText={setAnalysisChannelContext}
              placeholder="Motivational English Shorts"
            />
            <Pressable style={styles.button} onPress={handleAnalyzeChannel}>
              <Text style={styles.buttonText}>Analyze Channel</Text>
            </Pressable>
            {analysisStatus ? <Text style={styles.status}>{analysisStatus}</Text> : null}
            {analysisReport ? <Text style={styles.report}>{analysisReport}</Text> : null}
          </View>
        )}

        {activeTab === "automation" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Automation</Text>
            <View style={styles.rowBetween}>
              <Text style={styles.text}>Enable daily automation</Text>
              <Switch value={automationEnabled} onValueChange={toggleAutomation} />
            </View>
            <View style={styles.rowBetween}>
              <Text style={styles.text}>Auto upload to YouTube</Text>
              <Switch value={automationUpload} onValueChange={toggleAutomationUpload} />
            </View>
            <Pressable style={styles.button} onPress={runAutomation}>
              <Text style={styles.buttonText}>Run Automation Now</Text>
            </Pressable>
          </View>
        )}

        {activeTab === "settings" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Settings</Text>
            <Text style={styles.label}>Backend URL (Replit)</Text>
            <TextInput
              style={styles.input}
              placeholder="https://your-repl.replit.app"
              value={config.backendUrl}
              onChangeText={(value) => setConfig({ ...config, backendUrl: value })}
            />
            <Text style={styles.label}>OpenAI API Key</Text>
            <TextInput
              style={styles.input}
              secureTextEntry
              value={openaiKey}
              onChangeText={setOpenaiKey}
            />
            <Text style={styles.label}>ElevenLabs API Key</Text>
            <TextInput
              style={styles.input}
              secureTextEntry
              value={elevenLabsKey}
              onChangeText={setElevenLabsKey}
            />
            <Text style={styles.label}>OpenAI Model</Text>
            <TextInput
              style={styles.input}
              value={config.openaiModel}
              onChangeText={(value) => setConfig({ ...config, openaiModel: value })}
            />
            <Text style={styles.label}>OpenAI Base URL (optional)</Text>
            <TextInput
              style={styles.input}
              value={config.openaiBaseUrl}
              onChangeText={(value) => setConfig({ ...config, openaiBaseUrl: value })}
            />
            <View style={styles.rowBetween}>
              <Text style={styles.text}>Auto-generate title/tags</Text>
              <Switch
                value={config.autoMetadata !== false}
                onValueChange={(value) => setConfig({ ...config, autoMetadata: value })}
              />
            </View>
            <Text style={styles.label}>Channel context</Text>
            <TextInput
              style={styles.input}
              value={config.channelContext}
              onChangeText={(value) => setConfig({ ...config, channelContext: value })}
            />
            <Text style={styles.label}>Analysis video count</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={String(config.analysisVideoCount || 30)}
              onChangeText={(value) =>
                setConfig({ ...config, analysisVideoCount: Number(value) || 30 })
              }
            />
            <Text style={styles.label}>Default Script Prompt</Text>
            <TextInput
              style={styles.textArea}
              multiline
              value={config.defaultPrompt}
              onChangeText={(value) => setConfig({ ...config, defaultPrompt: value })}
            />
            <Text style={styles.label}>Default Voice</Text>
            <TextInput
              style={styles.input}
              value={config.defaultVoice}
              onChangeText={(value) => setConfig({ ...config, defaultVoice: value })}
            />
            <Text style={styles.label}>Default Title</Text>
            <TextInput
              style={styles.input}
              value={config.defaultTitle}
              onChangeText={(value) => setConfig({ ...config, defaultTitle: value })}
            />
            <Text style={styles.label}>Default Description</Text>
            <TextInput
              style={styles.textArea}
              multiline
              value={config.defaultDescription}
              onChangeText={(value) => setConfig({ ...config, defaultDescription: value })}
            />
            <Text style={styles.label}>Default Tags (comma separated)</Text>
            <TextInput
              style={styles.input}
              value={config.defaultTags.join(", ")}
              onChangeText={(value) =>
                setConfig({
                  ...config,
                  defaultTags: value.split(",").map((t) => t.trim()).filter(Boolean),
                })
              }
            />
            <Text style={styles.label}>Videos Per Day</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={String(config.videosPerDay)}
              onChangeText={(value) => setConfig({ ...config, videosPerDay: Number(value) || 1 })}
            />
            <Text style={styles.label}>Upload Time (HH:mm)</Text>
            <TextInput
              style={styles.input}
              value={config.uploadTime}
              onChangeText={(value) => setConfig({ ...config, uploadTime: value })}
            />
            <Text style={styles.label}>Max Duration (seconds)</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={String(config.maxDuration || 0)}
              onChangeText={(value) => setConfig({ ...config, maxDuration: Number(value) || 0 })}
            />
            <Text style={styles.label}>Subtitle Size</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={String(config.subtitleStyle.fontSize)}
              onChangeText={(value) =>
                setConfig({ ...config, subtitleStyle: { ...config.subtitleStyle, fontSize: Number(value) || 64 } })
              }
            />
            <Text style={styles.label}>Subtitle Outline</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={String(config.subtitleStyle.outline)}
              onChangeText={(value) =>
                setConfig({ ...config, subtitleStyle: { ...config.subtitleStyle, outline: Number(value) || 4 } })
              }
            />
            <Text style={styles.label}>Default Music Filename</Text>
            <TextInput
              style={styles.input}
              value={config.defaultMusic}
              onChangeText={(value) => setConfig({ ...config, defaultMusic: value })}
            />
            {musicTracks.length ? (
              <>
                <Text style={styles.label}>Pick Default Music</Text>
                {musicTracks.map((track) => (
                  <Pressable
                    key={track}
                    style={[styles.chip, config.defaultMusic === track && styles.chipActive]}
                    onPress={() => setConfig({ ...config, defaultMusic: track })}
                  >
                    <Text style={[styles.chipText, config.defaultMusic === track && styles.chipTextActive]}>
                      {track}
                    </Text>
                  </Pressable>
                ))}
              </>
            ) : null}
            <Pressable style={styles.button} onPress={saveConfig}>
              <Text style={styles.buttonText}>Save Settings</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={saveSecrets}>
              <Text style={styles.secondaryText}>Save API Keys</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={handleConnectYoutube}>
              <Text style={styles.secondaryText}>Connect YouTube</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff5ec" },
  header: { padding: 20 },
  title: { fontSize: 22, fontWeight: "700", color: "#1e1b16" },
  subtitle: { color: "#6a5f55" },
  container: { padding: 16, paddingBottom: 40 },
  tabRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  tabButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(30,20,10,0.12)",
    backgroundColor: "rgba(255,255,255,0.8)",
  },
  tabButtonActive: { backgroundColor: "#ff6b35", borderColor: "#ff6b35" },
  tabText: { fontSize: 12, color: "#1e1b16" },
  tabTextActive: { color: "#fff" },
  card: {
    backgroundColor: "#fffdf9",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(255,107,53,0.12)",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 2,
  },
  cardTitle: { fontWeight: "700", fontSize: 16, marginBottom: 8, color: "#1e1b16" },
  text: { color: "#1e1b16", marginBottom: 6 },
  status: { color: "#6a5f55", marginBottom: 8 },
  report: {
    color: "#1e1b16",
    backgroundColor: "#fff3e3",
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
    fontSize: 12,
    lineHeight: 18,
  },
  input: {
    borderWidth: 1,
    borderColor: "rgba(30,20,10,0.12)",
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
    backgroundColor: "#fff3e3",
  },
  textArea: {
    borderWidth: 1,
    borderColor: "rgba(30,20,10,0.12)",
    borderRadius: 12,
    padding: 10,
    backgroundColor: "#fff3e3",
    minHeight: 120,
    marginVertical: 10,
  },
  button: {
    backgroundColor: "#ff6b35",
    padding: 12,
    borderRadius: 999,
    alignItems: "center",
    marginBottom: 8,
  },
  buttonText: { color: "#fff", fontWeight: "700" },
  secondaryButton: {
    borderWidth: 1,
    borderColor: "#ff6b35",
    padding: 10,
    borderRadius: 999,
    alignItems: "center",
    marginBottom: 8,
  },
  secondaryText: { color: "#ff6b35", fontWeight: "600" },
  label: { color: "#6a5f55", marginTop: 8 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  historyRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  link: { paddingVertical: 4 },
  linkText: { color: "#d14b26", fontWeight: "600" },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  videoPreview: {
    borderRadius: 16,
    overflow: "hidden",
    marginVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(30,20,10,0.12)",
  },
  video: {
    width: "100%",
    aspectRatio: 9 / 16,
    backgroundColor: "#000",
  },
  chip: {
    borderWidth: 1,
    borderColor: "rgba(30,20,10,0.12)",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    marginBottom: 6,
    backgroundColor: "#fff",
    alignSelf: "flex-start",
  },
  chipActive: {
    backgroundColor: "#ff6b35",
    borderColor: "#ff6b35",
  },
  chipText: { color: "#1e1b16", fontSize: 12 },
  chipTextActive: { color: "#fff", fontWeight: "700" },
});
