import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Play, Pause, Square, Save, Upload, Plus, Trash2, Copy, RotateCcw, Clock, Sun, Moon, Leaf, Sparkles, ChevronDown, Film, Sprout, BrainCircuit, BarChart2, Info, Maximize, Minimize, Cpu, Power, PowerOff, AlertTriangle, CheckCircle, HelpCircle, HardDrive, X } from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";
import type { CellState, Keyframe, PredefinedPattern } from '../types';
import { CYCLE_DURATION, PATTERN_CATEGORIES } from '../constants';

// Type definition for Web Serial API, in case it's not globally available
declare global {
  // FIX: Add missing Web Serial API type definitions.
  interface SerialPortRequestOptions {
    filters?: { usbVendorId?: number; usbProductId?: number }[];
  }

  interface SerialOptions {
    baudRate: number;
    dataBits?: 7 | 8;
    stopBits?: 1 | 2;
    parity?: 'none' | 'even' | 'odd';
    bufferSize?: number;
    flowControl?: 'none' | 'hardware';
  }

  interface Navigator {
    serial: {
      requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
      getPorts(): Promise<SerialPort[]>;
    };
  }

  interface SerialPort extends EventTarget {
    open(options: SerialOptions): Promise<void>;
    close(): Promise<void>;
    readonly readable: ReadableStream<Uint8Array>;
    readonly writable: WritableStream<Uint8Array>;
  }
}


const ICONS: { [key: string]: React.FC<any> } = { Leaf, Sprout, Sparkles };

const HorticulturalLEDDesigner: React.FC = () => {
  const [gridSize, setGridSize] = useState(8);
  const [currentGrid, setCurrentGrid] = useState<CellState[]>([]);
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [animationSpeed, setAnimationSpeed] = useState(100);

  const [redValue, setRedValue] = useState(255);
  const [greenValue, setGreenValue] = useState(255);
  const [blueValue, setBlueValue] = useState(255);
  const [masterBrightness, setMasterBrightness] = useState(100);

  const [activePattern, setActivePattern] = useState({ categoryIndex: 0, patternIndex: 0 });
  
  const [keyframes, setKeyframes] = useState<Keyframe[]>(() => {
    const initialPattern = PATTERN_CATEGORIES[0].patterns[0];
    const kfSource = initialPattern.keyframes;
    const kfs = typeof kfSource === 'function' ? kfSource(8) : kfSource;
    return kfs.map(kf => ({
      ...kf,
      id: Date.now() + Math.random(),
    }));
  });
  const [selectedKeyframe, setSelectedKeyframe] = useState(0);
  
  const [greenProgram, setGreenProgram] = useState({ morning: false, midday: false, evening: false, night: false });
  const [redProgram, setRedProgram] = useState({ morning: false, midday: false, evening: false, night: false });
  const [blueProgram, setBlueProgram] = useState({ morning: false, midday: false, evening: false, night: false });
  const [dayNightCycle, setDayNightCycle] = useState({ start: 360, end: 1200 });
  
  const [isRenderingVideo, setIsRenderingVideo] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [showHowTo, setShowHowTo] = useState(false);
  const [showKeyframes, setShowKeyframes] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Gemini State
  const [showGeminiModal, setShowGeminiModal] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [geminiConfig, setGeminiConfig] = useState({
      goal: 'Maximize biomass for basil microgreens with strong purple coloration.',
      plantType: 'Basil',
      intensity: 'Medium',
      pulsing: 'None'
  });
  
  // Web Serial State
  const [serialPort, setSerialPort] = useState<SerialPort | null>(null);
  const [portWriter, setPortWriter] = useState<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connected' | 'connecting' | 'error'>('disconnected');
  const lastUpdateTime = useRef(0);


  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);

  const updateGridFromTimeline = useCallback((time: number) => {
    if (keyframes.length === 0) return;

    const sortedKeyframes = [...keyframes].sort((a, b) => a.time - b.time);
    let prevKeyframe = sortedKeyframes[sortedKeyframes.length - 1];
    let nextKeyframe = sortedKeyframes[0];

    for (let i = 0; i < sortedKeyframes.length; i++) {
        const current = sortedKeyframes[i];
        const next = sortedKeyframes[i + 1] || sortedKeyframes[0];
        if (time >= current.time && (time < next.time || current.time >= next.time)) {
            prevKeyframe = current;
            nextKeyframe = next;
            break;
        }
    }
    
    let timeDiff = nextKeyframe.time - prevKeyframe.time;
    if (timeDiff < 0) timeDiff += CYCLE_DURATION;
    let timeProgress = time - prevKeyframe.time;
    if (timeProgress < 0) timeProgress += CYCLE_DURATION;
    const factor = timeDiff === 0 ? 0 : timeProgress / timeDiff;

    const interpolateColor = (color1: CellState, color2: CellState, factor: number): CellState => {
        if (!color1 || !color2) return color1 || color2 || { r: 0, g: 0, b: 0, active: false };
        return {
          r: Math.round(color1.r + (color2.r - color1.r) * factor),
          g: Math.round(color1.g + (color2.g - color1.g) * factor),
          b: Math.round(color1.b + (color2.b - color1.b) * factor),
          active: factor < 0.5 ? color1.active : color2.active
        };
    };

    const initialGrid = Array.from({ length: gridSize * gridSize }, (_, index) => {
        const prevCell = prevKeyframe.grid[index] || { r: 0, g: 0, b: 0, active: false };
        const nextCell = nextKeyframe.grid[index] || { r: 0, g: 0, b: 0, active: false };
        return interpolateColor(prevCell, nextCell, factor);
    });

    const hour = time / 60;
    let redBoost = 0, greenBoost = 0, blueBoost = 0;

    if (redProgram.morning && hour >= 6 && hour < 12) redBoost = 50;
    else if (redProgram.midday && hour >= 12 && hour < 18) redBoost = 50;
    else if (redProgram.evening && hour >= 18 && hour < 22) redBoost = 30;
    else if (redProgram.night && (hour >= 22 || hour < 6)) redBoost = 10;
    
    if (greenProgram.morning && hour >= 6 && hour < 12) greenBoost = 50;
    else if (greenProgram.midday && hour >= 12 && hour < 18) greenBoost = 50;
    else if (greenProgram.evening && hour >= 18 && hour < 22) greenBoost = 30;
    else if (greenProgram.night && (hour >= 22 || hour < 6)) greenBoost = 10;
    
    if (blueProgram.morning && hour >= 6 && hour < 12) blueBoost = 50;
    else if (blueProgram.midday && hour >= 12 && hour < 18) blueBoost = 50;
    else if (blueProgram.evening && hour >= 18 && hour < 22) blueBoost = 30;
    else if (blueProgram.night && (hour >= 22 || hour < 6)) blueBoost = 10;

    const finalGrid = initialGrid.map(cell => ({
        ...cell,
        r: Math.min(255, cell.r + redBoost),
        g: Math.min(255, cell.g + greenBoost),
        b: Math.min(255, cell.b + blueBoost)
    }));

    setCurrentGrid(finalGrid);
  }, [keyframes, gridSize, greenProgram, redProgram, blueProgram]);

    const handleGeminiConfigChange = (field: string, value: string) => {
        setGeminiConfig(prev => ({ ...prev, [field]: value }));
    };

    const handleGeneratePattern = async () => {
        setIsGenerating(true);
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            const prompt = `
You are an expert horticultural lighting scientist. Your task is to generate a sophisticated 24-hour lighting recipe as a series of keyframes for a plant growth application.

**Constraints & Requirements:**
- **Total Cycle Duration:** ${CYCLE_DURATION} minutes (representing a 24-hour day).
- **LED Grid Size:** ${gridSize}x${gridSize}. For recipes that affect the whole grid uniformly, all cells in a keyframe's grid should have the same color and active state. For spatial patterns, vary the cells.
- **Output Format:** You MUST provide ONLY a valid JSON array of keyframe objects. Do not include any other text, explanations, or markdown formatting.

**User's Request:**
- **Plant Type:** ${geminiConfig.plantType}
- **Primary Goal:** ${geminiConfig.goal}
- **Desired Light Intensity:** ${geminiConfig.intensity} (Interpret as Low, Medium, High, or Very High PAR levels, and translate that into appropriate RGB brightness).
- **Pulsing Behavior:** ${geminiConfig.pulsing} (If not 'None', incorporate keyframes with rapid on/off or color changes to simulate pulsing).

**JSON Structure:**
Each object in the array must conform to this structure:
{
  "time": number,      // An integer from 0 to ${CYCLE_DURATION - 1}.
  "name": string,      // A descriptive name for the keyframe (e.g., "Sunrise", "Peak Growth").
  "grid": object[]     // An array of exactly ${gridSize * gridSize} cell state objects.
}

Each object within the "grid" array must have this structure:
{
  "r": number,         // Red value (0-255).
  "g": number,         // Green value (0-255).
  "b": number,         // Blue value (0-255).
  "active": boolean    // true if the LED is on, false if off.
}

**Example Output:**
[
  { "time": 360, "name": "Dawn", "grid": [{"r":255,"g":100,"b":50,"active":true}, ... (repeated ${gridSize * gridSize - 1} times)] },
  { "time": 720, "name": "Midday", "grid": [{"r":255,"g":255,"b":255,"active":true}, ... (repeated ${gridSize * gridSize - 1} times)] },
  { "time": 1200, "name": "Night", "grid": [{"r":0,"g":0,"b":0,"active":false}, ... (repeated ${gridSize * gridSize - 1} times)] }
]
`;

            const responseSchema = {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        name: { type: Type.STRING },
                        time: { type: Type.INTEGER },
                        grid: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    r: { type: Type.INTEGER },
                                    g: { type: Type.INTEGER },
                                    b: { type: Type.INTEGER },
                                    active: { type: Type.BOOLEAN },
                                },
                                required: ['r', 'g', 'b', 'active'],
                            },
                        },
                    },
                    required: ['name', 'time', 'grid'],
                },
            };

            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: responseSchema,
                },
            });
            
            const generatedKeyframes = JSON.parse(response.text);

            if (Array.isArray(generatedKeyframes) && generatedKeyframes.length > 0) {
                const newKeyframes = generatedKeyframes.map((kf: any) => ({
                    ...kf,
                    id: Date.now() + Math.random(),
                })).sort((a,b) => a.time - b.time);

                setKeyframes(newKeyframes);
                setSelectedKeyframe(0);
                setCurrentTime(newKeyframes[0].time);
                updateGridFromTimeline(newKeyframes[0].time);
                setActivePattern({ categoryIndex: -1, patternIndex: -1 }); // Indicate custom AI recipe
                setShowGeminiModal(false);
            } else {
                throw new Error("AI returned an empty or invalid pattern.");
            }

        } catch (error) {
            console.error("Error generating pattern with Gemini:", error);
            alert("Failed to generate AI pattern. Please check the console for details and try again.");
        } finally {
            setIsGenerating(false);
        }
    };
  
  const handleDisconnect = useCallback(async () => {
    if (portWriter) {
      try {
        await portWriter.close();
      } catch (e) {
        // Ignore errors, port might already be closed
      }
    }
    if (serialPort?.readable) {
      try {
        await serialPort.close();
      } catch (e) {
        // Ignore errors, port might already be closed
      }
    }
    setPortWriter(null);
    setSerialPort(null);
    setConnectionStatus('disconnected');
  }, [portWriter, serialPort]);

  const sendGridToArduino = useCallback(async (grid: CellState[]) => {
    if (!portWriter) return;

    // Protocol: [Start Byte (0xAB), Grid Size, R, G, B, ..., End Byte (0xBA)]
    const buffer = new Uint8Array(1 + 1 + gridSize * gridSize * 3 + 1);
    buffer[0] = 0xAB; // Start byte
    buffer[1] = gridSize; // Grid size (width and height are the same)
    
    let i = 2;
    for (const cell of grid) {
        const brightness = masterBrightness / 100;
        const r = Math.round((cell.active ? cell.r : 0) * brightness);
        const g = Math.round((cell.active ? cell.g : 0) * brightness);
        const b = Math.round((cell.active ? cell.b : 0) * brightness);
        buffer[i++] = r;
        buffer[i++] = g;
        buffer[i++] = b;
    }
    buffer[buffer.length - 1] = 0xBA; // End byte

    try {
        await portWriter.write(buffer);
    } catch (err) {
        console.error('Error writing to serial port:', err);
        handleDisconnect();
    }
  }, [portWriter, gridSize, masterBrightness, handleDisconnect]);
  
  const listenToPortClose = useCallback(async (port: SerialPort) => {
    try {
        // This is a bit of a hack. The 'disconnect' event is not standard.
        // A better way is to see if port becomes null after a disconnect.
        // For now, we rely on write errors to trigger disconnection.
    } catch (error) {
        console.error('Error listening to port close:', error);
    }
  }, [handleDisconnect]);

  const handleConnect = async () => {
    if (!('serial' in navigator)) {
        alert('Web Serial API not supported in this browser. Please use a compatible browser like Chrome, Edge, or Opera.');
        setConnectionStatus('error');
        return;
    }
    try {
        setConnectionStatus('connecting');
        const port = await navigator.serial.requestPort();
        await port.open({ baudRate: 115200 });
        const writer = port.writable.getWriter();
        setSerialPort(port);
        setPortWriter(writer);
        setConnectionStatus('connected');
        listenToPortClose(port);
    } catch (err) {
        console.error('Error connecting to serial port:', err);
        setConnectionStatus('error');
        setTimeout(() => { if (connectionStatus === 'error') setConnectionStatus('disconnected'); }, 3000);
    }
  };


  // Effect to stream data to Arduino
  useEffect(() => {
    if (connectionStatus === 'connected' && portWriter) {
        const now = Date.now();
        if (now - lastUpdateTime.current > 50) { // Throttle to max 20fps for performance
            sendGridToArduino(currentGrid);
            lastUpdateTime.current = now;
        }
    }
  }, [currentGrid, connectionStatus, portWriter, sendGridToArduino]);


  // Effect to handle resizing all keyframe grids when gridSize changes
  useEffect(() => {
    const newSize = gridSize * gridSize;
    setKeyframes(prevKeyframes => prevKeyframes.map(kf => ({
        ...kf,
        grid: Array.from({ length: newSize }, (_, i) => kf.grid[i] || { r: 0, g: 0, b: 0, active: false })
    })));
  }, [gridSize]);

  // Stabilized animation loop using setInterval
  useEffect(() => {
    if (isPlaying) {
      const intervalId = setInterval(() => {
        setCurrentTime(prev => (prev + 1) % CYCLE_DURATION);
      }, 1000 / (animationSpeed / 10));
      return () => clearInterval(intervalId);
    }
  }, [isPlaying, animationSpeed]);

  // Effect to update the grid display when time or keyframes change
  useEffect(() => {
      updateGridFromTimeline(currentTime);
  }, [currentTime, keyframes, updateGridFromTimeline]);
    
  useEffect(() => {
    const handleFullscreenChange = () => {
        setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

    const liveAnalysis = useMemo(() => {
        const activeCells = currentGrid.filter(c => c.active);
        if (activeCells.length === 0) {
            return { dominantSpectrum: 'Off', avgR: 0, avgG: 0, avgB: 0 };
        }
        const totals = activeCells.reduce((acc, cell) => {
            acc.r += cell.r;
            acc.g += cell.g;
            acc.b += cell.b;
            return acc;
        }, { r: 0, g: 0, b: 0 });

        const avgR = totals.r / activeCells.length;
        const avgG = totals.g / activeCells.length;
        const avgB = totals.b / activeCells.length;

        let dominantSpectrum = 'Balanced Mix';
        const threshold = 1.3; // 30% more than others
        if (avgR > avgG * threshold && avgR > avgB * threshold) dominantSpectrum = 'Red Dominant';
        else if (avgG > avgR * threshold && avgG > avgB * threshold) dominantSpectrum = 'Green Dominant';
        else if (avgB > avgR * threshold && avgB > avgG * threshold) dominantSpectrum = 'Blue Dominant';
        else if (Math.abs(avgR - avgG) < 25 && Math.abs(avgR - avgB) < 25 && avgR > 200) dominantSpectrum = 'Full Spectrum (White)';
        
        return { dominantSpectrum, avgR, avgG, avgB };
    }, [currentGrid]);

  const getAdjustedColor = useCallback((r: number, g: number, b: number): Omit<CellState, 'active'> => {
    const brightness = masterBrightness / 100;
    return {
      r: Math.round(r * brightness),
      g: Math.round(g * brightness),
      b: Math.round(b * brightness)
    };
  }, [masterBrightness]);
  
  const handleCellClick = (index: number) => {
    setSelectedCell(index);
    const newGrid = [...currentGrid];
    const adjustedColor = getAdjustedColor(redValue, greenValue, blueValue);
    newGrid[index] = { ...adjustedColor, active: !newGrid[index].active };
    setCurrentGrid(newGrid);
    
    if (keyframes[selectedKeyframe]) {
      const newKeyframes = [...keyframes];
      newKeyframes[selectedKeyframe].grid = [...newGrid];
      setKeyframes(newKeyframes);
    }
  };

  const loadPattern = useCallback((pattern: PredefinedPattern) => {
     const patternKeyframes = typeof pattern.keyframes === 'function' 
        ? pattern.keyframes(gridSize)
        : pattern.keyframes;

     const newKeyframes = patternKeyframes.map((kf: any) => ({
      ...kf,
      id: Date.now() + Math.random(),
    }));
    
    setKeyframes(newKeyframes);
    setSelectedKeyframe(0);
    const firstTime = newKeyframes.length > 0 ? newKeyframes[0].time : 0;
    setCurrentTime(firstTime);
    updateGridFromTimeline(firstTime); 
  }, [gridSize, updateGridFromTimeline]);
  
  const handlePatternSelect = (categoryIndex: number, patternIndex: number) => {
    setActivePattern({ categoryIndex, patternIndex });
    const pattern = PATTERN_CATEGORIES[categoryIndex].patterns[patternIndex];
    loadPattern(pattern);
  };
  
  const reloadCurrentPattern = () => {
    if (activePattern.categoryIndex === -1) {
        alert("Cannot reload an AI-generated or custom pattern. Please select a predefined pattern first.");
        return;
    }
    const pattern = PATTERN_CATEGORIES[activePattern.categoryIndex].patterns[activePattern.patternIndex];
    loadPattern(pattern);
  };

  const addKeyframe = () => {
    const newKeyframe: Keyframe = {
      id: Date.now(),
      time: Math.floor(currentTime),
      name: `Scene ${keyframes.length + 1}`,
      grid: [...currentGrid]
    };
    const newKeyframes = [...keyframes, newKeyframe].sort((a, b) => a.time - b.time);
    setKeyframes(newKeyframes);
    setSelectedKeyframe(newKeyframes.findIndex(k => k.id === newKeyframe.id));
  };

  const deleteKeyframe = (idToDelete: number) => {
    if (keyframes.length > 1) {
      const newKeyframes = keyframes.filter((kf) => kf.id !== idToDelete);
      setKeyframes(newKeyframes);
      if (selectedKeyframe >= newKeyframes.length) {
          setSelectedKeyframe(newKeyframes.length - 1);
      }
    }
  };

  const loadKeyframe = (index: number) => {
    setSelectedKeyframe(index);
    setCurrentTime(keyframes[index].time);
    setCurrentGrid([...keyframes[index].grid]);
  };

  const updateKeyframeTime = (id: number, newTime: number) => {
    const newKeyframes = keyframes.map(kf => 
        kf.id === id ? { ...kf, time: Math.max(0, Math.min(newTime, CYCLE_DURATION - 1)) } : kf
    );
    setKeyframes(newKeyframes.sort((a, b) => a.time - b.time));
  };

  const updateKeyframeName = (id: number, newName: string) => {
    const newKeyframes = keyframes.map(kf => 
        kf.id === id ? { ...kf, name: newName } : kf
    );
    setKeyframes(newKeyframes);
  };

  const fillAll = () => {
    const adjustedColor = getAdjustedColor(redValue, greenValue, blueValue);
    const newGrid = Array(gridSize * gridSize).fill(null).map(() => ({ 
      ...adjustedColor, active: true 
    }));
    setCurrentGrid(newGrid);
    if (keyframes[selectedKeyframe]) {
      const newKeyframes = [...keyframes];
      newKeyframes[selectedKeyframe].grid = [...newGrid];
      setKeyframes(newKeyframes);
    }
  };

  const clearAll = () => {
    const newGrid = Array(gridSize * gridSize).fill(null).map(() => ({ 
      r: 0, g: 0, b: 0, active: false 
    }));
    setCurrentGrid(newGrid);
    if (keyframes[selectedKeyframe]) {
      const newKeyframes = [...keyframes];
      newKeyframes[selectedKeyframe].grid = [...newGrid];
      setKeyframes(newKeyframes);
    }
  };
  
  const currentPatternName = activePattern.categoryIndex === -1 
    ? "AI Generated Recipe" 
    : PATTERN_CATEGORIES[activePattern.categoryIndex]?.patterns[activePattern.patternIndex]?.name || "Custom Recipe";


  const saveRecipe = () => {
    const recipe = {
      metadata: { name: currentPatternName, created: new Date().toISOString(), version: "1.0", gridSize, cycleDuration: CYCLE_DURATION, cycleUnit: "minutes", description: "Custom 24-hour lighting pattern" },
      keyframes: keyframes.map(kf => ({ id: kf.id, name: kf.name, time: kf.time, timeFormatted: formatTime(kf.time), grid: kf.grid.map(cell => ({ red: cell.r, green: cell.g, blue: cell.b, active: cell.active })) })),
      instructions: { microcontroller: "Compatible with Arduino/Raspberry Pi", notes: "24-hour cycle. Time values in minutes (0-1439). RGB values 0-255. Grid indexed row-major order.", example: "Use keyframe interpolation for smooth transitions between lighting phases." }
    };
    const blob = new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${recipe.metadata.name.toLowerCase().replace(/\s+/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const loadRecipe = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const recipe = JSON.parse(e.target?.result as string);
          if (recipe.keyframes) {
            const loadedKeyframes: Keyframe[] = recipe.keyframes.map((kf: any) => ({
              id: kf.id || Date.now() + Math.random(), name: kf.name, time: kf.time,
              grid: kf.grid.map((cell: any) => ({ r: cell.red, g: cell.green, b: cell.blue, active: cell.active }))
            }));
            if (recipe.metadata?.gridSize) setGridSize(recipe.metadata.gridSize);
            setActivePattern({ categoryIndex: -1, patternIndex: 0 }); // Indicate custom recipe
            setKeyframes(loadedKeyframes);
            setSelectedKeyframe(0);
            setCurrentTime(0);
            updateGridFromTimeline(0);
          }
        } catch (error) { alert('Error loading recipe file'); }
      };
      // FIX: Corrected typo in FileReader method name.
      reader.readAsText(file);
    }
  };
  
  const formatTime = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = Math.floor(minutes % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
        gridContainerRef.current?.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
  };

  const renderConnectionStatus = () => {
    switch (connectionStatus) {
      case 'connected':
        return <><CheckCircle className="text-green-500 mr-2" /> Connected</>;
      case 'connecting':
        return <><Cpu className="text-blue-500 mr-2 animate-pulse" /> Connecting...</>;
      case 'error':
        return <><AlertTriangle className="text-red-500 mr-2" /> Connection Error</>;
      default:
        return <><PowerOff className="text-gray-500 mr-2" /> Disconnected</>;
    }
  };

  const ArduinoCodeSnippet = `
#include <FastLED.h>

// --- Configuration ---
#define GRID_SIZE 8       // The width/height of your LED matrix (e.g., 8 for an 8x8 matrix)
#define NUM_LEDS (GRID_SIZE * GRID_SIZE)
#define LED_PIN 6         // The data pin your LED matrix is connected to
#define LED_TYPE WS2812B  // LED chipset (e.g., WS2812B, SK6812)
#define COLOR_ORDER GRB   // Color order for your specific LEDs
#define MAX_BRIGHTNESS 150 // Set a safety limit for brightness (0-255)

CRGB leds[NUM_LEDS];
byte buffer[1 + 1 + NUM_LEDS * 3 + 1];

// --- Setup Function ---
void setup() {
  Serial.begin(115200);
  FastLED.addLeds<LED_TYPE, LED_PIN, COLOR_ORDER>(leds, NUM_LEDS)
         .setCorrection(TypicalLEDStrip);
  FastLED.setBrightness(MAX_BRIGHTNESS);
  
  // Optional: Run a startup animation
  for(int i = 0; i < NUM_LEDS; i++) {
    leds[i] = CRGB::Blue;
    FastLED.show();
    delay(10);
  }
  for(int i = 0; i < NUM_LEDS; i++) {
    leds[i] = CRGB::Black;
    FastLED.show();
    delay(10);
  }
}

// --- Main Loop ---
void loop() {
  // Check if the start byte is available
  if (Serial.available() > 0 && Serial.read() == 0xAB) {
    // Expected packet size: grid_size_byte + color_data + end_byte
    size_t packet_size = 1 + (GRID_SIZE * GRID_SIZE * 3) + 1;
    
    // Wait for the full packet to arrive with a timeout
    unsigned long startTime = millis();
    while (Serial.available() < packet_size) {
      if (millis() - startTime > 100) {
        return; // Timeout, abort reading
      }
    }

    // Read grid size (we use it to validate)
    byte receivedGridSize = Serial.read();
    if (receivedGridSize != GRID_SIZE) {
      // Mismatch, flush the buffer and wait for a new start byte
      while(Serial.available()) Serial.read();
      return; 
    }

    // Read color data into a temporary buffer
    byte color_buffer[NUM_LEDS * 3];
    Serial.readBytes(color_buffer, NUM_LEDS * 3);
    
    // Read and validate end byte
    if (Serial.read() == 0xBA) {
      // If packet is valid, update LEDs
      for (int i = 0; i < NUM_LEDS; i++) {
        leds[i].setRGB(color_buffer[i*3], color_buffer[i*3+1], color_buffer[i*3+2]);
      }
      FastLED.show();
    } else {
        // End byte mismatch, flush and wait for a new start byte
        while(Serial.available()) Serial.read();
    }
  }
}
  `.trim();

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4 font-sans">
        {showGeminiModal && (
            <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50" aria-modal="true" role="dialog">
                <div className="bg-gray-800 rounded-lg shadow-2xl p-6 w-full max-w-lg">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-bold text-cyan-400 flex items-center"><BrainCircuit className="mr-2"/>Generate with AI</h2>
                        <button onClick={() => setShowGeminiModal(false)} className="text-gray-400 hover:text-white"><X size={24}/></button>
                    </div>
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="plantType" className="block text-sm font-medium text-gray-300 mb-1">Plant Type</label>
                            <input
                                type="text"
                                id="plantType"
                                value={geminiConfig.plantType}
                                onChange={(e) => handleGeminiConfigChange('plantType', e.target.value)}
                                className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 focus:ring-cyan-500 focus:border-cyan-500"
                                placeholder="e.g., Tomato, Lettuce, Basil"
                            />
                        </div>
                        <div>
                            <label htmlFor="goal" className="block text-sm font-medium text-gray-300 mb-1">Primary Goal</label>
                            <textarea
                                id="goal"
                                value={geminiConfig.goal}
                                onChange={(e) => handleGeminiConfigChange('goal', e.target.value)}
                                rows={3}
                                className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 focus:ring-cyan-500 focus:border-cyan-500"
                                placeholder="Describe the desired outcome, e.g., 'Encourage flowering' or 'Promote compact leafy growth'."
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="intensity" className="block text-sm font-medium text-gray-300 mb-1">Desired Intensity</label>
                                <select id="intensity" value={geminiConfig.intensity} onChange={(e) => handleGeminiConfigChange('intensity', e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 focus:ring-cyan-500 focus:border-cyan-500">
                                    <option>Low</option>
                                    <option>Medium</option>
                                    <option>High</option>
                                    <option>Very High</option>
                                </select>
                            </div>
                             <div>
                                <label htmlFor="pulsing" className="block text-sm font-medium text-gray-300 mb-1">Pulsing Behavior</label>
                                <select id="pulsing" value={geminiConfig.pulsing} onChange={(e) => handleGeminiConfigChange('pulsing', e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 focus:ring-cyan-500 focus:border-cyan-500">
                                    <option>None</option>
                                    <option>Slow Pulses</option>
                                    <option>Fast Pulses</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    <div className="mt-6">
                        <button
                            onClick={handleGeneratePattern}
                            disabled={isGenerating}
                            className="w-full flex items-center justify-center bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-bold py-2 px-4 rounded-md transition-colors"
                        >
                            {isGenerating ? (
                                <>
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-3"></div>
                                Generating...
                                </>
                            ) : (
                                "Generate Pattern"
                            )}
                        </button>
                    </div>
                </div>
            </div>
        )}
      <header className="flex justify-between items-center mb-4 pb-2 border-b border-gray-700">
        <h1 className="text-3xl font-bold text-cyan-400 flex items-center"><Leaf className="mr-3" />Horticultural LED Designer</h1>
        <div className="flex items-center space-x-4">
            <button onClick={() => setShowHowTo(!showHowTo)} className="flex items-center text-gray-300 hover:text-white transition-colors"><HelpCircle size={20} className="mr-1" /> How to Use & Setup</button>
            <button onClick={() => setShowGeminiModal(true)} className="flex items-center bg-purple-600 hover:bg-purple-700 px-3 py-2 rounded-md transition-colors"><BrainCircuit size={18} className="mr-2"/>Generate with AI</button>
            <button onClick={saveRecipe} className="flex items-center bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded-md transition-colors"><Save size={18} className="mr-2"/>Save Recipe</button>
            <button onClick={() => fileInputRef.current?.click()} className="flex items-center bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-md transition-colors"><Upload size={18} className="mr-2"/>Load Recipe</button>
            <input type="file" ref={fileInputRef} onChange={loadRecipe} accept=".json" className="hidden" />
        </div>
      </header>
      
      {showHowTo && (
        <div className="bg-gray-800 p-6 rounded-lg mb-4 text-gray-300 prose prose-invert prose-sm max-w-none prose-pre:bg-gray-900 prose-pre:p-4 prose-pre:rounded-md">
            <h2 className="text-xl font-bold text-white mb-4">How to Use This Tool & Connect Hardware</h2>
            <p>This tool allows you to design, simulate, and control physical LED arrays for horticultural or creative projects. Follow the steps below to connect your Arduino and LED matrix.</p>

            <h3 className="text-lg font-semibold text-cyan-400 mt-4">1. Required Hardware</h3>
            <ul>
                <li>An Arduino-compatible board (e.g., Arduino Uno, Nano, ESP32).</li>
                <li>An addressable LED strip or matrix (e.g., WS2812B "NeoPixel").</li>
                <li>A suitable 5V power supply (ensure it can provide enough current for all your LEDs).</li>
                <li>Jumper wires.</li>
            </ul>
            
            <h3 className="text-lg font-semibold text-cyan-400 mt-4">2. Wiring</h3>
            <p><strong>Safety First: Disconnect all power before wiring.</strong></p>
            <ol>
                <li>Connect the Arduino's <strong>GND</strong> pin to both the power supply's Ground and the LED matrix's GND pin.</li>
                <li>Connect the power supply's <strong>5V</strong> output directly to the LED matrix's 5V (or VCC) pin. <strong>Do not power the matrix from the Arduino's 5V pin.</strong></li>
                <li>Connect the Arduino's <strong>Digital Pin 6</strong> (or your chosen pin) to the LED matrix's Data Input (DI or DIN) pin.</li>
            </ol>

            <h3 className="text-lg font-semibold text-cyan-400 mt-4">3. Arduino Setup</h3>
            <ol>
                <li>Download and install the <a href="https://www.arduino.cc/en/software" target="_blank" rel="noopener noreferrer">Arduino IDE</a>.</li>
                <li>In the Arduino IDE, go to <strong>Tools &gt; Manage Libraries...</strong> and install the "FastLED" library.</li>
                <li>Create a new sketch and paste the code below.</li>
                <li><strong>IMPORTANT:</strong> In the code, adjust <code>GRID_SIZE</code> and <code>LED_PIN</code> to match your hardware setup.</li>
                <li>Connect your Arduino to your computer via USB, select the correct Board and Port from the <strong>Tools</strong> menu, and click "Upload".</li>
            </ol>
            
            <h3 className="text-lg font-semibold text-cyan-400 mt-4">4. Arduino Sketch</h3>
            <pre><code>{ArduinoCodeSnippet}</code></pre>

            <h3 className="text-lg font-semibold text-cyan-400 mt-4">5. Connecting from the Web App</h3>
            <ol>
                <li>Once the code is uploaded to your Arduino, return to this web page.</li>
                <li>In the "Hardware Integration" panel, click the <strong>Connect to Arduino</strong> button.</li>
                <li>A popup will appear. Select your Arduino's serial port (it might be labeled as "USB-SERIAL CH340" or similar) and click "Connect".</li>
                <li>The status should change to "Connected", and your physical LEDs will now mirror the grid in real-time!</li>
            </ol>
        </div>
      )}


      <div className="flex flex-col lg:flex-row gap-4">
        {/* Left Column: Grid and Timeline */}
        <div className="flex-grow lg:w-2/3">
           <div className="bg-gray-800 p-4 rounded-lg shadow-lg mb-4">
            <h3 className="text-lg font-semibold mb-3 text-cyan-400">Playback Controls</h3>
             <div className="flex items-center space-x-4 mb-4">
                <label htmlFor="speed" className="flex items-center font-semibold text-sm"><Clock size={16} className="mr-2" />Speed:</label>
                <input
                    id="speed"
                    type="range"
                    min="1"
                    max="1000"
                    step="1"
                    value={animationSpeed}
                    onChange={(e) => setAnimationSpeed(Number(e.target.value))}
                    className="flex-grow h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                />
                <span className="text-md font-mono w-20 text-center bg-gray-900 px-2 py-1 rounded">{animationSpeed / 10}x</span>
             </div>
             <div className="flex items-center space-x-4">
                <button onClick={() => setIsPlaying(!isPlaying)} className="p-2 bg-cyan-600 hover:bg-cyan-700 rounded-full">{isPlaying ? <Pause /> : <Play />}</button>
                <div className="flex items-center text-xl font-mono w-24"><Clock size={20} className="mr-2" />{formatTime(currentTime)}</div>
                <input
                    type="range"
                    min="0"
                    max={CYCLE_DURATION - 1}
                    value={currentTime}
                    onChange={(e) => setCurrentTime(Number(e.target.value))}
                    className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                    aria-label="Timeline"
                />
            </div>
          </div>
          <div ref={gridContainerRef} className="bg-gray-800 p-4 rounded-lg shadow-lg flex flex-col items-center justify-center aspect-square relative">
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridSize}, 1fr)`, gap: '2px', width: '100%', height: '100%' }}>
              {currentGrid.map((cell, index) => (
                <div
                  key={index}
                  onClick={() => handleCellClick(index)}
                  className={`w-full h-full cursor-pointer transition-all duration-100 ease-in-out ${selectedCell === index ? 'ring-2 ring-cyan-400 ring-inset' : ''}`}
                  style={{ backgroundColor: `rgba(${cell.r}, ${cell.g}, ${cell.b}, ${cell.active ? 1 : 0.1})` }}
                  aria-label={`LED ${index + 1}`}
                ></div>
              ))}
            </div>
            <button onClick={toggleFullscreen} className="absolute top-2 right-2 p-2 bg-gray-900 bg-opacity-50 rounded-full hover:bg-opacity-75 transition-opacity">
              {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
            </button>
          </div>
        </div>

        {/* Right Column: Control Panels */}
        <div className="flex-grow lg:w-1/3 space-y-4">
           {/* Hardware Integration */}
          <div className="bg-gray-800 p-4 rounded-lg shadow-lg">
            <h3 className="text-lg font-semibold mb-3 flex items-center text-cyan-400"><HardDrive className="mr-2" />Hardware Integration</h3>
            <div className="flex justify-between items-center">
                <div className="flex items-center font-medium text-lg">{renderConnectionStatus()}</div>
                {connectionStatus !== 'connected' ? (
                  <button onClick={handleConnect} disabled={connectionStatus === 'connecting'} className="flex items-center bg-green-600 hover:bg-green-700 px-4 py-2 rounded-md transition-colors disabled:bg-gray-500">
                      <Power size={18} className="mr-2"/>Connect to Arduino
                  </button>
                ) : (
                  <button onClick={handleDisconnect} className="flex items-center bg-red-600 hover:bg-red-700 px-4 py-2 rounded-md transition-colors">
                      <PowerOff size={18} className="mr-2"/>Disconnect
                  </button>
                )}
            </div>
          </div>

          <div className="bg-gray-800 p-4 rounded-lg shadow-lg">
            <h3 className="text-lg font-semibold mb-3 text-cyan-400">Master Controls</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="gridSize" className="block text-sm mb-1">Grid Size: {gridSize}x{gridSize}</label>
                <input id="gridSize" type="range" min="4" max="32" value={gridSize} onChange={(e) => setGridSize(Number(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg" />
              </div>
              <div>
                <label htmlFor="masterBrightness" className="block text-sm mb-1">Brightness: {masterBrightness}%</label>
                <input id="masterBrightness" type="range" min="0" max="100" value={masterBrightness} onChange={(e) => setMasterBrightness(Number(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg" />
              </div>
            </div>
            <div className="mt-4 flex space-x-2">
                <button onClick={fillAll} className="w-full bg-blue-600 hover:bg-blue-700 p-2 rounded-md text-sm">Fill All</button>
                <button onClick={clearAll} className="w-full bg-gray-600 hover:bg-gray-700 p-2 rounded-md text-sm">Clear All</button>
            </div>
          </div>

          <div className="bg-gray-800 p-4 rounded-lg shadow-lg">
            <h3 className="text-lg font-semibold mb-3 text-cyan-400">Color Picker</h3>
            <div className="space-y-2">
                <input type="range" min="0" max="255" value={redValue} onChange={(e) => setRedValue(Number(e.target.value))} className="w-full h-2 bg-red-500 rounded-lg appearance-none cursor-pointer" />
                <input type="range" min="0" max="255" value={greenValue} onChange={(e) => setGreenValue(Number(e.target.value))} className="w-full h-2 bg-green-500 rounded-lg appearance-none cursor-pointer" />
                <input type="range" min="0" max="255" value={blueValue} onChange={(e) => setBlueValue(Number(e.target.value))} className="w-full h-2 bg-blue-500 rounded-lg appearance-none cursor-pointer" />
            </div>
            <div className="mt-4 p-4 rounded-lg" style={{ backgroundColor: `rgb(${redValue}, ${greenValue}, ${blueValue})` }}>
                <p className="text-center font-mono mix-blend-difference">{`RGB(${redValue}, ${greenValue}, ${blueValue})`}</p>
            </div>
          </div>
          
          <div className="bg-gray-800 p-4 rounded-lg shadow-lg">
            <h3 className="text-lg font-semibold mb-3 text-cyan-400 flex justify-between items-center">
                Predefined Patterns
                <button onClick={reloadCurrentPattern} title="Reload pattern" className="p-1 text-gray-400 hover:text-white"><RotateCcw size={16}/></button>
            </h3>
            {PATTERN_CATEGORIES.map((category, catIndex) => (
                <div key={catIndex} className="mb-2">
                  <h4 className="font-bold text-gray-400 flex items-center text-sm mb-1">{React.createElement(ICONS[category.icon] || Leaf, { className: 'mr-2' })}{category.name}</h4>
                  <div className="flex flex-wrap gap-2">
                    {category.patterns.map((pattern, patIndex) => (
                      <button 
                        key={patIndex}
                        onClick={() => handlePatternSelect(catIndex, patIndex)}
                        className={`text-xs px-2 py-1 rounded-full transition-colors ${activePattern.categoryIndex === catIndex && activePattern.patternIndex === patIndex ? 'bg-cyan-500 text-white font-bold' : 'bg-gray-700 hover:bg-gray-600'}`}
                      >
                          {pattern.name}
                      </button>
                    ))}
                  </div>
                </div>
            ))}
          </div>

        </div>
      </div>
      
       {/* Keyframes Panel */}
      <div className="bg-gray-800 p-4 rounded-lg shadow-lg mt-4">
        <h3 className="text-lg font-semibold mb-3 text-cyan-400 flex items-center cursor-pointer" onClick={() => setShowKeyframes(!showKeyframes)}>
            <Film className="mr-2" />Keyframes
            <ChevronDown className={`ml-2 transition-transform ${showKeyframes ? 'rotate-180' : ''}`} />
        </h3>
        {showKeyframes && (
            <div className="overflow-x-auto">
                <div className="flex space-x-4 pb-2 min-w-max">
                {keyframes.map((kf, index) => (
                    <div key={kf.id} className={`p-3 rounded-lg w-48 flex-shrink-0 cursor-pointer border-2 ${selectedKeyframe === index ? 'border-cyan-400 bg-gray-700' : 'border-transparent bg-gray-900 hover:bg-gray-700'}`} onClick={() => loadKeyframe(index)}>
                        <div className="flex justify-between items-center mb-2">
                          <input type="text" value={kf.name} onChange={(e) => updateKeyframeName(kf.id, e.target.value)} className="bg-transparent text-white font-bold text-sm w-full mr-2" />
                          <button onClick={(e) => { e.stopPropagation(); deleteKeyframe(kf.id);}} className="text-red-500 hover:text-red-400"><Trash2 size={16}/></button>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Clock size={14} />
                            <input type="number" value={kf.time} onChange={(e) => updateKeyframeTime(kf.id, Number(e.target.value))} className="bg-gray-800 rounded px-1 text-sm w-16" />
                            <span className="text-xs text-gray-400">{formatTime(kf.time)}</span>
                        </div>
                    </div>
                ))}
                <button onClick={addKeyframe} className="flex-shrink-0 w-24 flex items-center justify-center bg-green-600 hover:bg-green-700 rounded-lg"><Plus /></button>
                </div>
            </div>
        )}
      </div>

    </div>
  );
};

export default HorticulturalLEDDesigner;
