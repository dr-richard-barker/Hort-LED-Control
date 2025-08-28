import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Play, Pause, Square, Save, Upload, Plus, Trash2, Copy, RotateCcw, Clock, Sun, Moon, Leaf, Sparkles, ChevronDown, Film, Sprout, BrainCircuit, BarChart2, Info, Maximize, Minimize, Cpu, Power, PowerOff, AlertTriangle, CheckCircle, HelpCircle, HardDrive, X, Palette } from 'lucide-react';
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

// --- Helper & Optimization Components ---

const GridCell = React.memo(({ cell, isSelected, onClick }: { cell: CellState, isSelected: boolean, onClick: () => void }) => {
  return (
    <div
      onClick={onClick}
      className={`w-full h-full cursor-pointer transition-colors duration-100 ${isSelected ? 'ring-2 ring-cyan-400 ring-inset' : ''}`}
      style={{ backgroundColor: `rgba(${cell.r}, ${cell.g}, ${cell.b}, ${cell.active ? 1 : 0.1})` }}
      aria-label={`LED cell`}
    />
  );
});

const Spectrometer = React.memo(({ avgR, avgG, avgB }: { avgR: number, avgG: number, avgB: number }) => {
    const width = 300;
    const height = 150;
    const padding = 20;

    const spectrumPath = useMemo(() => {
        const gaussian = (x: number, mean: number, stdDev: number, amplitude: number) => {
            if (amplitude === 0) return 0;
            return amplitude * Math.exp(-Math.pow(x - mean, 2) / (2 * Math.pow(stdDev, 2)));
        };

        const points = [];
        let maxIntensity = 0;

        for (let wl = 380; wl <= 780; wl += 5) {
            const rIntensity = gaussian(wl, 640, 40, avgR);
            const gIntensity = gaussian(wl, 540, 40, avgG);
            const bIntensity = gaussian(wl, 460, 35, avgB);
            const totalIntensity = rIntensity + gIntensity + bIntensity;
            if (totalIntensity > maxIntensity) maxIntensity = totalIntensity;
            points.push({ wl, intensity: totalIntensity });
        }

        if (maxIntensity === 0) maxIntensity = 255;

        return points.map(p => {
            const x = padding + ((p.wl - 380) / 400) * (width - 2 * padding);
            const y = height - padding - (p.intensity / maxIntensity) * (height - 2 * padding);
            return `${x},${y}`;
        }).join(' ');
    }, [avgR, avgG, avgB]);

    return (
        <div className="relative">
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto bg-gray-900 rounded-md">
                <defs>
                    <linearGradient id="spectrumGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#4f00bc" />
                        <stop offset="15%" stopColor="#0000ff" />
                        <stop offset="30%" stopColor="#00ffff" />
                        <stop offset="50%" stopColor="#00ff00" />
                        <stop offset="70%" stopColor="#ffff00" />
                        <stop offset="85%" stopColor="#ff7f00" />
                        <stop offset="100%" stopColor="#ff0000" />
                    </linearGradient>
                </defs>
                <rect x={padding} y={padding} width={width - 2 * padding} height={height - 2 * padding} fill="url(#spectrumGradient)" opacity={0.3} />
                <polyline
                    fill="none"
                    stroke="white"
                    strokeWidth="2"
                    points={spectrumPath}
                />
                {/* X-Axis Labels */}
                <text x={padding} y={height - 5} fill="#9ca3af" fontSize="10">400nm</text>
                <text x={width - padding} y={height - 5} fill="#9ca3af" fontSize="10" textAnchor="end">780nm</text>
                <text x={width / 2} y={height - 5} fill="#9ca3af" fontSize="10" textAnchor="middle">Wavelength</text>
                 {/* Y-Axis Label */}
                <text x={10} y={height / 2} fill="#9ca3af" fontSize="10" transform={`rotate(-90, 10, ${height/2})`} textAnchor="middle">Intensity</text>
            </svg>
        </div>
    );
});


const HorticulturalLEDDesigner: React.FC = () => {
  const [gridSize, setGridSize] = useState(8);
  const [currentGrid, setCurrentGrid] = useState<CellState[]>([]);
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [absoluteTime, setAbsoluteTime] = useState(0); 
  const [animationSpeed, setAnimationSpeed] = useState(100);

  const [redValue, setRedValue] = useState(255);
  const [greenValue, setGreenValue] = useState(255);
  const [blueValue, setBlueValue] = useState(255);
  const [masterBrightness, setMasterBrightness] = useState(100);

  const [activePattern, setActivePattern] = useState({ categoryIndex: 0, patternIndex: 0 });
  
  const [totalDays, setTotalDays] = useState(7);
  const [colorPresets, setColorPresets] = useState<{r: number, g: number, b: number}[]>([]);

  const [keyframesByDay, setKeyframesByDay] = useState<Keyframe[][]>(() => {
    const initialPattern = PATTERN_CATEGORIES[0].patterns[0];
    const kfSource = initialPattern.keyframes;
    const kfs = (typeof kfSource === 'function' ? kfSource(8) : kfSource).map((kf, i) => ({
      ...kf,
      id: Date.now() + Math.random() + i,
    }));
    return Array(7).fill(null).map(() => JSON.parse(JSON.stringify(kfs)));
  });
  
  const [selectedDay, setSelectedDay] = useState(0); // 0-13 for Day 1-14
  const [selectedKeyframe, setSelectedKeyframe] = useState(0);
  
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
  const animationFrameId = useRef<number>();
  const lastAnimationTime = useRef<number>(performance.now());


  const currentDay = Math.floor(absoluteTime / CYCLE_DURATION) % totalDays;
  const currentTime = absoluteTime % CYCLE_DURATION;
  const keyframes = useMemo(() => keyframesByDay[selectedDay] || [], [keyframesByDay, selectedDay]);
  
  // Load/Save Color Presets from/to localStorage
  useEffect(() => {
    try {
      const savedPresets = localStorage.getItem('horti_color_presets');
      if (savedPresets) setColorPresets(JSON.parse(savedPresets));
    } catch (e) { console.error("Failed to load color presets", e); }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('horti_color_presets', JSON.stringify(colorPresets));
    } catch (e) { console.error("Failed to save color presets", e); }
  }, [colorPresets]);
  
  const updateGridFromTimeline = useCallback((time: number, day: number) => {
    const dayKeyframes = keyframesByDay[day] || [];
    if (dayKeyframes.length === 0) {
      setCurrentGrid(Array.from({ length: gridSize * gridSize }, () => ({ r: 0, g: 0, b: 0, active: false })));
      return;
    }

    const sortedKeyframes = [...dayKeyframes].sort((a, b) => a.time - b.time);
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

    const newGrid = Array.from({ length: gridSize * gridSize }, (_, index) => {
        const prevCell = prevKeyframe.grid[index] || { r: 0, g: 0, b: 0, active: false };
        const nextCell = nextKeyframe.grid[index] || { r: 0, g: 0, b: 0, active: false };
        return interpolateColor(prevCell, nextCell, factor);
    });
    
    setCurrentGrid(newGrid);
  }, [gridSize, keyframesByDay]);

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

                setKeyframesByDay(prev => {
                    const newDays = [...prev];
                    newDays[selectedDay] = newKeyframes;
                    return newDays;
                });
                setSelectedKeyframe(0);
                setAbsoluteTime(selectedDay * CYCLE_DURATION + (newKeyframes[0].time || 0));
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
      } catch (e) {}
    }
    if (serialPort?.readable) {
      try {
        await serialPort.close();
      } catch (e) {}
    }
    setPortWriter(null);
    setSerialPort(null);
    setConnectionStatus('disconnected');
  }, [portWriter, serialPort]);

  const sendGridToArduino = useCallback(async (grid: CellState[]) => {
    if (!portWriter) return;

    const buffer = new Uint8Array(1 + 1 + gridSize * gridSize * 3 + 1);
    buffer[0] = 0xAB; 
    buffer[1] = gridSize;
    
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
    buffer[buffer.length - 1] = 0xBA;

    try {
        await portWriter.write(buffer);
    } catch (err) {
        console.error('Error writing to serial port:', err);
        handleDisconnect();
    }
  }, [portWriter, gridSize, masterBrightness, handleDisconnect]);
  
  const handleConnect = async () => {
    if (!('serial' in navigator)) {
        alert('Web Serial API not supported. Use Chrome, Edge, or Opera.');
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
    } catch (err) {
        console.error('Error connecting to serial port:', err);
        setConnectionStatus('error');
        setTimeout(() => { if (connectionStatus === 'error') setConnectionStatus('disconnected'); }, 3000);
    }
  };

  useEffect(() => {
    if (connectionStatus === 'connected' && portWriter) {
        const now = Date.now();
        if (now - lastUpdateTime.current > 50) {
            sendGridToArduino(currentGrid);
            lastUpdateTime.current = now;
        }
    }
  }, [currentGrid, connectionStatus, portWriter, sendGridToArduino]);

  useEffect(() => {
    const newSize = gridSize * gridSize;
    setKeyframesByDay(prevDays => prevDays.map(dayKeyframes => 
        dayKeyframes.map(kf => ({
            ...kf,
            grid: Array.from({ length: newSize }, (_, i) => kf.grid[i] || { r: 0, g: 0, b: 0, active: false })
        }))
    ));
  }, [gridSize]);

  useEffect(() => {
    const animate = (timestamp: number) => {
      const deltaTime = timestamp - lastAnimationTime.current;
      lastAnimationTime.current = timestamp;

      const speedMultiplier = animationSpeed / 10;
      const timeIncrement = deltaTime * (speedMultiplier / 1000);
      
      setAbsoluteTime(prev => (prev + timeIncrement) % (CYCLE_DURATION * totalDays));
      
      animationFrameId.current = requestAnimationFrame(animate);
    };

    if (isPlaying) {
      lastAnimationTime.current = performance.now();
      animationFrameId.current = requestAnimationFrame(animate);
    }

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [isPlaying, animationSpeed, totalDays]);

  useEffect(() => {
      updateGridFromTimeline(currentTime, currentDay);
  }, [absoluteTime, keyframesByDay, updateGridFromTimeline, currentTime, currentDay]);
    
  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

    const liveAnalysis = useMemo(() => {
        const activeCells = currentGrid.filter(c => c.active);
        if (activeCells.length === 0) return { dominantSpectrum: 'Off', avgR: 0, avgG: 0, avgB: 0 };
        const totals = activeCells.reduce((acc, cell) => {
            acc.r += cell.r; acc.g += cell.g; acc.b += cell.b;
            return acc;
        }, { r: 0, g: 0, b: 0 });

        const avgR = totals.r / activeCells.length;
        const avgG = totals.g / activeCells.length;
        const avgB = totals.b / activeCells.length;

        let dominantSpectrum = 'Balanced';
        const threshold = 1.3;
        if (avgR > avgG * threshold && avgR > avgB * threshold) dominantSpectrum = 'Red Dominant';
        else if (avgG > avgR * threshold && avgG > avgB * threshold) dominantSpectrum = 'Green Dominant';
        else if (avgB > avgR * threshold && avgB > avgG * threshold) dominantSpectrum = 'Blue Dominant';
        else if (Math.abs(avgR - avgG) < 25 && Math.abs(avgR - avgB) < 25 && avgR > 200) dominantSpectrum = 'Full Spectrum';
        
        return { dominantSpectrum, avgR, avgG, avgB };
    }, [currentGrid]);

  const getAdjustedColor = useCallback((r: number, g: number, b: number): Omit<CellState, 'active'> => {
    const brightness = masterBrightness / 100;
    return { r: Math.round(r * brightness), g: Math.round(g * brightness), b: Math.round(b * brightness) };
  }, [masterBrightness]);
  
  const handleCellClick = useCallback((index: number) => {
    setSelectedCell(index);
    const currentDayKeyframes = keyframesByDay[selectedDay] || [];
    if (!currentDayKeyframes[selectedKeyframe]) return;

    const newGrid = [...currentDayKeyframes[selectedKeyframe].grid];
    const adjustedColor = getAdjustedColor(redValue, greenValue, blueValue);
    newGrid[index] = { ...adjustedColor, active: !newGrid[index].active };
    
    const newKeyframes = [...currentDayKeyframes];
    newKeyframes[selectedKeyframe] = { ...newKeyframes[selectedKeyframe], grid: newGrid };
    
    setKeyframesByDay(prev => {
        const newDays = [...prev];
        newDays[selectedDay] = newKeyframes;
        return newDays;
    });
    // Also update live grid if we're at that keyframe's time
    if(currentTime === currentDayKeyframes[selectedKeyframe].time && selectedDay === currentDay) {
        updateGridFromTimeline(currentTime, currentDay);
    }
  }, [selectedDay, selectedKeyframe, keyframesByDay, getAdjustedColor, redValue, greenValue, blueValue, currentTime, currentDay, updateGridFromTimeline]);

  const loadPattern = useCallback((pattern: PredefinedPattern, dayIndex: number) => {
     const patternKeyframes = typeof pattern.keyframes === 'function' ? pattern.keyframes(gridSize) : pattern.keyframes;
     const newKeyframes = patternKeyframes.map((kf: any) => ({ ...kf, id: Date.now() + Math.random() }));
    
    setKeyframesByDay(prev => {
        const newDays = [...prev];
        newDays[dayIndex] = newKeyframes;
        return newDays;
    });
    setSelectedKeyframe(0);
    const firstTime = newKeyframes.length > 0 ? newKeyframes[0].time : 0;
    setAbsoluteTime(dayIndex * CYCLE_DURATION + firstTime);
  }, [gridSize]);
  
  const handlePatternSelect = (categoryIndex: number, patternIndex: number) => {
    setActivePattern({ categoryIndex, patternIndex });
    const pattern = PATTERN_CATEGORIES[categoryIndex].patterns[patternIndex];
    loadPattern(pattern, selectedDay);
  };
  
  const reloadCurrentPattern = () => {
    if (activePattern.categoryIndex === -1) {
        alert("Cannot reload an AI or custom pattern. Please select a predefined pattern.");
        return;
    }
    const pattern = PATTERN_CATEGORIES[activePattern.categoryIndex].patterns[activePattern.patternIndex];
    loadPattern(pattern, selectedDay);
  };

  const addKeyframe = () => {
    const currentDayKeyframes = keyframesByDay[selectedDay] || [];
    const newKeyframe: Keyframe = {
      id: Date.now(),
      time: Math.floor(currentTime),
      name: `Scene ${currentDayKeyframes.length + 1}`,
      grid: [...currentGrid]
    };
    const newKeyframes = [...currentDayKeyframes, newKeyframe].sort((a, b) => a.time - b.time);
    setKeyframesByDay(prev => {
        const newDays = [...prev];
        newDays[selectedDay] = newKeyframes;
        return newDays;
    });
    setSelectedKeyframe(newKeyframes.findIndex(k => k.id === newKeyframe.id));
  };

  const deleteKeyframe = (idToDelete: number) => {
    const currentDayKeyframes = keyframesByDay[selectedDay] || [];
    if (currentDayKeyframes.length > 1) {
      const newKeyframes = currentDayKeyframes.filter((kf) => kf.id !== idToDelete);
      setKeyframesByDay(prev => {
          const newDays = [...prev];
          newDays[selectedDay] = newKeyframes;
          return newDays;
      });
      if (selectedKeyframe >= newKeyframes.length) {
          setSelectedKeyframe(newKeyframes.length - 1);
      }
    }
  };

  const loadKeyframe = (index: number) => {
    const kf = keyframesByDay[selectedDay][index];
    if (kf) {
      setSelectedKeyframe(index);
      setAbsoluteTime(selectedDay * CYCLE_DURATION + kf.time);
    }
  };

  const updateKeyframeTime = (id: number, newTime: number) => {
    const currentDayKeyframes = keyframesByDay[selectedDay] || [];
    const newKeyframes = currentDayKeyframes.map(kf => 
        kf.id === id ? { ...kf, time: Math.max(0, Math.min(newTime, CYCLE_DURATION - 1)) } : kf
    );
    setKeyframesByDay(prev => {
        const newDays = [...prev];
        newDays[selectedDay] = newKeyframes.sort((a,b) => a.time - b.time);
        return newDays;
    });
  };

  const updateKeyframeName = (id: number, newName: string) => {
    const currentDayKeyframes = keyframesByDay[selectedDay] || [];
    const newKeyframes = currentDayKeyframes.map(kf => kf.id === id ? { ...kf, name: newName } : kf);
    setKeyframesByDay(prev => {
        const newDays = [...prev];
        newDays[selectedDay] = newKeyframes;
        return newDays;
    });
  };
  
  const copyDayToAll = () => {
    const currentDayKeyframes = keyframesByDay[selectedDay];
    if (window.confirm(`This will overwrite all ${totalDays} days with the current day's schedule. Are you sure?`)) {
        setKeyframesByDay(Array(totalDays).fill(null).map(() => JSON.parse(JSON.stringify(currentDayKeyframes))));
    }
  };

  const fillAll = () => {
    const adjustedColor = getAdjustedColor(redValue, greenValue, blueValue);
    const newGrid = Array(gridSize * gridSize).fill(null).map(() => ({ ...adjustedColor, active: true }));
    const currentDayKeyframes = keyframesByDay[selectedDay] || [];
    if (currentDayKeyframes[selectedKeyframe]) {
      const newKeyframes = [...currentDayKeyframes];
      newKeyframes[selectedKeyframe] = { ...newKeyframes[selectedKeyframe], grid: newGrid };
      setKeyframesByDay(prev => {
          const newDays = [...prev];
          newDays[selectedDay] = newKeyframes;
          return newDays;
      });
      if (currentTime === currentDayKeyframes[selectedKeyframe].time && currentDay === selectedDay) updateGridFromTimeline(currentTime, currentDay);
    }
  };

  const clearAll = () => {
    const newGrid = Array(gridSize * gridSize).fill(null).map(() => ({ r: 0, g: 0, b: 0, active: false }));
    const currentDayKeyframes = keyframesByDay[selectedDay] || [];
    if (currentDayKeyframes[selectedKeyframe]) {
      const newKeyframes = [...currentDayKeyframes];
      newKeyframes[selectedKeyframe] = { ...newKeyframes[selectedKeyframe], grid: newGrid };
      setKeyframesByDay(prev => {
          const newDays = [...prev];
          newDays[selectedDay] = newKeyframes;
          return newDays;
      });
      if (currentTime === currentDayKeyframes[selectedKeyframe].time && currentDay === selectedDay) updateGridFromTimeline(currentTime, currentDay);
    }
  };

  const handleTotalDaysChange = (newDayCount: number) => {
    const clampedDayCount = Math.max(1, Math.min(14, newDayCount));
    const currentDayCount = keyframesByDay.length;

    if (clampedDayCount === currentDayCount) return;

    setKeyframesByDay(currentKeyframes => {
      if (clampedDayCount > currentDayCount) {
        const lastDay = currentKeyframes[currentDayCount - 1] || [];
        const newDays = Array(clampedDayCount - currentDayCount).fill(null).map(() => JSON.parse(JSON.stringify(lastDay)));
        return [...currentKeyframes, ...newDays];
      } else {
        return currentKeyframes.slice(0, clampedDayCount);
      }
    });

    setTotalDays(clampedDayCount);

    if (selectedDay >= clampedDayCount) setSelectedDay(clampedDayCount - 1);
    if (absoluteTime >= clampedDayCount * CYCLE_DURATION) setAbsoluteTime(clampedDayCount * CYCLE_DURATION - 1);
  };
  
  const currentPatternName = activePattern.categoryIndex === -1 ? "AI/Custom Recipe" : PATTERN_CATEGORIES[activePattern.categoryIndex]?.patterns[activePattern.patternIndex]?.name || "Custom";

  const saveRecipe = () => {
    const recipe = {
      metadata: { name: currentPatternName, created: new Date().toISOString(), version: "2.1", gridSize, totalDays },
      keyframesByDay: keyframesByDay.map(dayKfs => dayKfs.map(kf => ({ id: kf.id, name: kf.name, time: kf.time, grid: kf.grid.map(cell => ({ r: cell.r, g: cell.g, b: cell.b, active: cell.active })) })))
    };
    const blob = new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${totalDays}-day-${currentPatternName.toLowerCase().replace(/\s+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
  };

  const loadRecipe = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const recipe = JSON.parse(e.target?.result as string);
        if (recipe.keyframesByDay) { // New format (v2.0+)
          const loadedKeyframes: Keyframe[][] = recipe.keyframesByDay.map((dayKfs: any[]) =>
            dayKfs.map((kf: any) => ({
              id: kf.id || Date.now() + Math.random(), name: kf.name, time: kf.time,
              grid: kf.grid.map((cell: any) => ({ r: cell.r, g: cell.g, b: cell.b, active: cell.active }))
            }))
          );
          setKeyframesByDay(loadedKeyframes);
          setTotalDays(recipe.metadata?.totalDays || recipe.keyframesByDay.length);
        } else if (recipe.keyframes) { // Old 1-day format (v1.0)
          const loadedKeyframes: Keyframe[] = recipe.keyframes.map((kf: any) => ({
            id: kf.id || Date.now() + Math.random(), name: kf.name, time: kf.time,
            grid: kf.grid.map((cell: any) => ({ r: cell.red, g: cell.green, b: cell.blue, active: cell.active }))
          }));
          setTotalDays(7);
          setKeyframesByDay(Array(7).fill(null).map(() => JSON.parse(JSON.stringify(loadedKeyframes))));
          alert("Legacy 1-day recipe loaded and applied to all 7 days of a new 7-day schedule.");
        }
        if (recipe.metadata?.gridSize) setGridSize(recipe.metadata.gridSize);
        setActivePattern({ categoryIndex: -1, patternIndex: 0 });
        setSelectedDay(0);
        setSelectedKeyframe(0);
        setAbsoluteTime(0);
      } catch (error) { alert('Error loading recipe file.'); console.error(error); }
    };
    reader.readAsText(file);
    if(fileInputRef.current) fileInputRef.current.value = "";
  };

  const saveCurrentColor = () => {
    const newColor = { r: redValue, g: greenValue, b: blueValue };
    if (!colorPresets.some(p => p.r === newColor.r && p.g === newColor.g && p.b === newColor.b)) {
      setColorPresets(prev => [...prev, newColor]);
    }
  };

  const applyColorPreset = (preset: {r: number, g: number, b: number}) => {
    setRedValue(preset.r);
    setGreenValue(preset.g);
    setBlueValue(preset.b);
  };
  
  const deleteColorPreset = (index: number) => {
    setColorPresets(prev => prev.filter((_, i) => i !== index));
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
      case 'connected': return <><CheckCircle className="text-green-500 mr-2" /> Connected</>;
      case 'connecting': return <><Cpu className="text-blue-500 mr-2 animate-pulse" /> Connecting...</>;
      case 'error': return <><AlertTriangle className="text-red-500 mr-2" /> Error</>;
      default: return <><PowerOff className="text-gray-500 mr-2" /> Disconnected</>;
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

void setup() {
  Serial.begin(115200);
  FastLED.addLeds<LED_TYPE, LED_PIN, COLOR_ORDER>(leds, NUM_LEDS).setCorrection(TypicalLEDStrip);
  FastLED.setBrightness(MAX_BRIGHTNESS);
}

void loop() {
  if (Serial.available() > 0 && Serial.read() == 0xAB) {
    size_t packet_size = 1 + (GRID_SIZE * GRID_SIZE * 3) + 1;
    unsigned long startTime = millis();
    while (Serial.available() < packet_size) {
      if (millis() - startTime > 100) return;
    }

    byte receivedGridSize = Serial.read();
    if (receivedGridSize != GRID_SIZE) {
      while(Serial.available()) Serial.read();
      return; 
    }

    byte color_buffer[NUM_LEDS * 3];
    Serial.readBytes(color_buffer, NUM_LEDS * 3);
    
    if (Serial.read() == 0xBA) {
      for (int i = 0; i < NUM_LEDS; i++) {
        leds[i].setRGB(color_buffer[i*3], color_buffer[i*3+1], color_buffer[i*3+2]);
      }
      FastLED.show();
    } else {
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
                            <input type="text" id="plantType" value={geminiConfig.plantType} onChange={(e) => handleGeminiConfigChange('plantType', e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 focus:ring-cyan-500 focus:border-cyan-500" placeholder="e.g., Tomato, Lettuce, Basil"/>
                        </div>
                        <div>
                            <label htmlFor="goal" className="block text-sm font-medium text-gray-300 mb-1">Primary Goal</label>
                            <textarea id="goal" value={geminiConfig.goal} onChange={(e) => handleGeminiConfigChange('goal', e.target.value)} rows={3} className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 focus:ring-cyan-500 focus:border-cyan-500" placeholder="Describe the desired outcome..."/>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="intensity" className="block text-sm font-medium text-gray-300 mb-1">Desired Intensity</label>
                                <select id="intensity" value={geminiConfig.intensity} onChange={(e) => handleGeminiConfigChange('intensity', e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2">
                                    <option>Low</option><option>Medium</option><option>High</option><option>Very High</option>
                                </select>
                            </div>
                             <div>
                                <label htmlFor="pulsing" className="block text-sm font-medium text-gray-300 mb-1">Pulsing Behavior</label>
                                <select id="pulsing" value={geminiConfig.pulsing} onChange={(e) => handleGeminiConfigChange('pulsing', e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2">
                                    <option>None</option><option>Slow Pulses</option><option>Fast Pulses</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    <div className="mt-6">
                        <button onClick={handleGeneratePattern} disabled={isGenerating} className="w-full flex items-center justify-center bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-bold py-2 px-4 rounded-md transition-colors">
                            {isGenerating ? (<><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-3"></div>Generating...</>) : ("Generate Pattern")}
                        </button>
                    </div>
                </div>
            </div>
        )}
      <header className="flex justify-between items-center mb-4 pb-2 border-b border-gray-700">
        <h1 className="text-3xl font-bold text-cyan-400 flex items-center"><Leaf className="mr-3" />Horticultural LED Designer</h1>
        <div className="flex items-center space-x-4">
            <button onClick={() => setShowHowTo(!showHowTo)} className="flex items-center text-gray-300 hover:text-white transition-colors"><HelpCircle size={20} className="mr-1" /> How to Use</button>
            <button onClick={() => setShowGeminiModal(true)} className="flex items-center bg-purple-600 hover:bg-purple-700 px-3 py-2 rounded-md transition-colors"><BrainCircuit size={18} className="mr-2"/>Generate with AI</button>
            <button onClick={saveRecipe} className="flex items-center bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded-md transition-colors"><Save size={18} className="mr-2"/>Save Recipe</button>
            <button onClick={() => fileInputRef.current?.click()} className="flex items-center bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-md transition-colors"><Upload size={18} className="mr-2"/>Load Recipe</button>
            <input type="file" ref={fileInputRef} onChange={loadRecipe} accept=".json" className="hidden" />
        </div>
      </header>
      
      {showHowTo && (
        <div className="bg-gray-800 p-6 rounded-lg mb-4 text-gray-300 prose prose-invert prose-sm max-w-none prose-pre:bg-gray-900 prose-pre:p-4 prose-pre:rounded-md">
            <h2 className="text-xl font-bold text-white mb-4">How to Use & Connect Hardware</h2>
            <ol>
                <li><strong>Design Your Schedule:</strong> Use the "Recipe Duration" to set your schedule length (1-14 days). Select a day to edit its 24-hour keyframe cycle.</li>
                <li><strong>Use AI:</strong> Click "Generate with AI" to create a lighting recipe for the selected day based on your plant's needs.</li>
                <li><strong>Copy Schedule:</strong> Use the "Copy to All Days" button in the Keyframes panel to quickly apply one day's schedule to the entire recipe.</li>
                <li><strong>Connect Hardware:</strong> Use the "Hardware Integration" panel to connect to your Arduino. Your physical LEDs will then follow the schedule in real-time.</li>
            </ol>
            <h3 className="text-lg font-semibold text-cyan-400 mt-4">Arduino Sketch</h3>
            <pre><code>{ArduinoCodeSnippet}</code></pre>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-4">
        {/* Left Column: Grid and Timeline */}
        <div className="flex-grow lg:w-2/3">
           <div className="bg-gray-800 p-4 rounded-lg shadow-lg mb-4">
            <h3 className="text-lg font-semibold mb-3 text-cyan-400">Day Planner & Playback</h3>
             <div className="flex items-center justify-between mb-4 border-b border-gray-700 pb-4">
                <div className="flex items-center space-x-2">
                    <label htmlFor="totalDays" className="font-semibold text-sm whitespace-nowrap">Recipe Duration:</label>
                    <input type="number" id="totalDays" value={totalDays} onChange={(e) => handleTotalDaysChange(Number(e.target.value))} min="1" max="14" className="bg-gray-900 text-white w-16 text-center rounded-md p-1 border border-gray-600" />
                    <span className="text-sm">days</span>
                </div>
                 <div className="flex items-center space-x-2">
                    <label htmlFor="speed" className="flex items-center font-semibold text-sm"><Clock size={16} className="mr-1" />Speed:</label>
                    <input id="speed" type="range" min="1" max="10000" step="1" value={animationSpeed} onChange={(e) => setAnimationSpeed(Number(e.target.value))} className="w-24 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer" />
                    <span className="text-sm font-mono w-16 text-center bg-gray-900 px-2 py-1 rounded">{animationSpeed / 10}x</span>
                 </div>
             </div>
             <div className="overflow-x-auto pb-2 mb-4">
                 <div className="flex space-x-2 w-max">
                    {Array.from({ length: totalDays }).map((_, index) => (
                        <button key={index} onClick={() => { setSelectedDay(index); setAbsoluteTime(index * CYCLE_DURATION); }}
                            className={`px-4 py-2 rounded-md font-bold text-sm flex-shrink-0 transition-colors ${selectedDay === index ? 'bg-cyan-500 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>
                            Day {index + 1}
                        </button>
                    ))}
                 </div>
            </div>
             <div className="flex items-center space-x-4">
                <button onClick={() => setIsPlaying(!isPlaying)} className="p-2 bg-cyan-600 hover:bg-cyan-700 rounded-full">{isPlaying ? <Pause /> : <Play />}</button>
                <div className="flex items-center text-xl font-mono w-48"><span className="font-sans text-lg mr-2 text-cyan-400">Day {currentDay + 1}</span>{formatTime(currentTime)}</div>
                <input type="range" min="0" max={CYCLE_DURATION * totalDays - 1} value={absoluteTime} onChange={(e) => setAbsoluteTime(Number(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer" aria-label="Timeline"/>
            </div>
          </div>
          <div ref={gridContainerRef} className="bg-gray-800 p-4 rounded-lg shadow-lg flex flex-col items-center justify-center aspect-square relative">
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridSize}, 1fr)`, gap: '2px', width: '100%', height: '100%' }}>
              {currentGrid.map((cell, index) => (
                <GridCell key={index} cell={cell} isSelected={selectedCell === index} onClick={() => handleCellClick(index)} />
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
                      <Power size={18} className="mr-2"/>Connect
                  </button>
                ) : (
                  <button onClick={handleDisconnect} className="flex items-center bg-red-600 hover:bg-red-700 px-4 py-2 rounded-md transition-colors">
                      <PowerOff size={18} className="mr-2"/>Disconnect
                  </button>
                )}
            </div>
          </div>
          
          <div className="bg-gray-800 p-4 rounded-lg shadow-lg">
            <h3 className="text-lg font-semibold mb-3 flex items-center text-cyan-400"><BarChart2 className="mr-2" />Live Spectrum Analysis</h3>
            <div className="text-sm text-gray-400 mb-2">Dominant Spectrum: <span className="font-bold text-white">{liveAnalysis.dominantSpectrum}</span></div>
            <Spectrometer avgR={liveAnalysis.avgR} avgG={liveAnalysis.avgG} avgB={liveAnalysis.avgB} />
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
                <button onClick={fillAll} className="w-full bg-blue-600 hover:bg-blue-700 p-2 rounded-md text-sm">Fill Keyframe</button>
                <button onClick={clearAll} className="w-full bg-gray-600 hover:bg-gray-700 p-2 rounded-md text-sm">Clear Keyframe</button>
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
            <div className="mt-4 pt-3 border-t border-gray-700">
                <div className="flex justify-between items-center mb-2">
                    <h4 className="text-sm font-semibold text-gray-300 flex items-center"><Palette size={16} className="mr-2"/>Color Presets</h4>
                    <button onClick={saveCurrentColor} className="text-xs bg-cyan-600 hover:bg-cyan-700 px-2 py-1 rounded-md transition-colors">Save Color</button>
                </div>
                <div className="grid grid-cols-8 gap-2">
                    {colorPresets.map((preset, index) => (
                        <div key={index} className="relative group aspect-square">
                            <div onClick={() => applyColorPreset(preset)} className="w-full h-full rounded cursor-pointer border-2 border-gray-600 hover:border-cyan-400" style={{ backgroundColor: `rgb(${preset.r}, ${preset.g}, ${preset.b})` }} />
                            <button onClick={() => deleteColorPreset(index)} className="absolute -top-1 -right-1 w-5 h-5 bg-red-600 rounded-full flex items-center justify-center text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500" aria-label="Delete preset"><X size={12}/></button>
                        </div>
                    ))}
                </div>
            </div>
          </div>
          
          <div className="bg-gray-800 p-4 rounded-lg shadow-lg">
            <h3 className="text-lg font-semibold mb-3 text-cyan-400 flex justify-between items-center">Predefined Patterns</h3>
            {PATTERN_CATEGORIES.map((category, catIndex) => (
                <div key={catIndex} className="mb-2">
                  <h4 className="font-bold text-gray-400 flex items-center text-sm mb-1">{React.createElement(ICONS[category.icon] || Leaf, { className: 'mr-2' })}{category.name}</h4>
                  <div className="flex flex-wrap gap-2">
                    {category.patterns.map((pattern, patIndex) => (
                      <button key={patIndex} onClick={() => handlePatternSelect(catIndex, patIndex)}
                        className={`text-xs px-2 py-1 rounded-full transition-colors ${activePattern.categoryIndex === catIndex && activePattern.patternIndex === patIndex && currentDay === selectedDay ? 'bg-cyan-500 text-white font-bold' : 'bg-gray-700 hover:bg-gray-600'}`}>
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
        <div className="flex justify-between items-center mb-3">
            <h3 className="text-lg font-semibold text-cyan-400 flex items-center cursor-pointer" onClick={() => setShowKeyframes(!showKeyframes)}>
                <Film className="mr-2" />Keyframes for Day {selectedDay + 1}
                <ChevronDown className={`ml-2 transition-transform ${showKeyframes ? 'rotate-180' : ''}`} />
            </h3>
            <div className="flex items-center space-x-2">
                <button onClick={reloadCurrentPattern} title="Reload pattern" className="p-1 text-gray-400 hover:text-white"><RotateCcw size={16}/></button>
                <button onClick={copyDayToAll} className="flex items-center bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded-md text-sm transition-colors"><Copy size={14} className="mr-2"/>Copy to All Days</button>
            </div>
        </div>
        {showKeyframes && (
            <div className="overflow-x-auto">
                <div className="flex space-x-4 pb-2 min-w-max">
                {(keyframesByDay[selectedDay] || []).map((kf, index) => (
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