'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';

interface Order {
    id: number;
    date_created: string;
    status: string;
    total: string;
    billing_address?: {
        zip?: string;
        city?: string;
        country?: string;
    };
}

interface Coords {
    lat: number;
    lng: number;
    area: string;
}

export default function SalesMapPage() {
    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<L.Map | null>(null);
    const [todayCount, setTodayCount] = useState(0);
    const [monthCount, setMonthCount] = useState(0);
    const [status, setStatus] = useState('Connecting...');
    const [leafletLoaded, setLeafletLoaded] = useState(false);
    const knownOrderIds = useRef<Set<number>>(new Set());
    const postcodeCache = useRef<Record<string, Coords>>({});

    const postcodeToLatLng = async (postcode: string): Promise<Coords | null> => {
        if (!postcode) return null;
        
        const cleanPostcode = postcode.replace(/\s+/g, '').toUpperCase();
        
        if (postcodeCache.current[cleanPostcode]) {
            return postcodeCache.current[cleanPostcode];
        }
        
        try {
            const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(cleanPostcode)}`);
            const data = await response.json();
            
            if (data.status === 200 && data.result) {
                const coords: Coords = {
                    lat: data.result.latitude,
                    lng: data.result.longitude,
                    area: data.result.admin_district || data.result.region || 'UK'
                };
                postcodeCache.current[cleanPostcode] = coords;
                return coords;
            }
        } catch (e) {
            console.error('Postcode lookup failed:', e);
        }
        
        return null;
    };

    const playSound = () => {
        const sound = document.getElementById('cashSound') as HTMLAudioElement;
        if (sound) {
            sound.currentTime = 0;
            sound.play().catch(e => console.log('Sound play blocked:', e));
        }
    };

    const flashScreen = () => {
        const overlay = document.getElementById('flashOverlay');
        if (overlay) {
            overlay.classList.add('active');
            setTimeout(() => overlay.classList.remove('active'), 200);
        }
    };

    const addMarker = (lat: number, lng: number, area: string, time: string, isNew = true) => {
        if (!mapInstanceRef.current || typeof window === 'undefined') return;
        
        const L = (window as unknown as { L: typeof import('leaflet') }).L;
        const size = 12;
        const icon = L.divIcon({
            className: 'sale-marker' + (isNew ? ' new' : ''),
            iconSize: [size, size],
            iconAnchor: [size/2, size/2]
        });
        
        const marker = L.marker([lat, lng], { icon }).addTo(mapInstanceRef.current);
        
        const popupContent = `
            <div class="sale-popup">
                <div class="location">${area}</div>
                <div class="time">${time}</div>
            </div>
        `;
        marker.bindPopup(popupContent);
        
        if (isNew) {
            playSound();
            flashScreen();
        }
    };

    const processOrder = async (order: Order) => {
        if (knownOrderIds.current.has(order.id)) return;
        
        knownOrderIds.current.add(order.id);
        
        const postcode = order.billing_address?.zip;
        
        if (postcode) {
            const coords = await postcodeToLatLng(postcode);
            if (coords) {
                const time = new Date(order.date_created).toLocaleTimeString('en-GB', {
                    hour: '2-digit',
                    minute: '2-digit'
                });
                
                addMarker(coords.lat, coords.lng, coords.area, time, true);
                
                setTodayCount(prev => prev + 1);
                setMonthCount(prev => prev + 1);
            }
        }
    };

    const fetchOrders = async () => {
        try {
            const response = await fetch('/api/sales-map/orders');
            const data = await response.json();
            
            if (data.orders && data.orders.length > 0) {
                setStatus('Live');
                
                for (const order of data.orders) {
                    await processOrder(order);
                }
            } else {
                setStatus('Live');
            }
        } catch (e) {
            console.error('Failed to fetch orders:', e);
            setStatus('Reconnecting...');
        }
    };

    useEffect(() => {
        if (!leafletLoaded || !mapRef.current || mapInstanceRef.current) return;
        
        const L = (window as unknown as { L: typeof import('leaflet') }).L;
        
        const map = L.map(mapRef.current, {
            zoomControl: false,
            attributionControl: false
        }).setView([54.5, -2], 6);
        
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 19
        }).addTo(map);
        
        mapInstanceRef.current = map;
        
        // Start fetching orders
        fetchOrders();
        const interval = setInterval(fetchOrders, 5 * 60 * 1000); // 5 minutes
        
        return () => {
            clearInterval(interval);
            map.remove();
            mapInstanceRef.current = null;
        };
    }, [leafletLoaded]);

    return (
        <>
            <Script 
                src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
                onLoad={() => setLeafletLoaded(true)}
            />
            <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
            
            <style jsx global>{`
                body {
                    margin: 0;
                    padding: 0;
                    overflow: hidden;
                    background: #1a1a2e;
                }
                .sale-marker {
                    background: #F7941D;
                    border: 3px solid #fff;
                    border-radius: 50%;
                    box-shadow: 0 0 10px rgba(247, 148, 29, 0.5);
                }
                .sale-marker.new {
                    animation: newSale 1s ease-out;
                }
                @keyframes newSale {
                    0% { transform: scale(0); opacity: 0; }
                    50% { transform: scale(1.5); }
                    100% { transform: scale(1); opacity: 1; }
                }
                .sale-popup { text-align: center; }
                .sale-popup .location { font-weight: bold; font-size: 14px; }
                .sale-popup .time { font-size: 11px; color: #666; }
                .flash-overlay.active { opacity: 1 !important; }
            `}</style>
            
            <div style={{
                position: 'fixed',
                top: 20,
                left: 20,
                zIndex: 1000,
                fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
                color: 'white'
            }}>
                <span style={{ fontSize: 24, fontWeight: 'bold', color: '#F7941D' }}>GTSE</span> Live Sales
            </div>
            
            <div style={{
                position: 'fixed',
                top: 20,
                right: 20,
                background: 'rgba(26, 26, 46, 0.95)',
                border: '1px solid #333',
                borderRadius: 8,
                padding: '10px 15px',
                zIndex: 1000,
                fontSize: 12,
                color: 'white',
                fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"
            }}>
                <span style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    background: '#00ff00',
                    borderRadius: '50%',
                    marginRight: 8,
                    animation: 'pulse 2s infinite'
                }} />
                <span>{status}</span>
            </div>
            
            <div 
                ref={mapRef} 
                style={{ width: '100vw', height: '100vh' }}
            />
            
            <div style={{
                position: 'fixed',
                bottom: 20,
                right: 20,
                background: 'rgba(26, 26, 46, 0.95)',
                border: '2px solid #F7941D',
                borderRadius: 12,
                padding: '20px 30px',
                zIndex: 1000,
                minWidth: 200,
                fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
                color: 'white'
            }}>
                <div style={{ marginBottom: 15 }}>
                    <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: '#888', marginBottom: 5 }}>
                        Today
                    </div>
                    <div style={{ fontSize: 36, fontWeight: 'bold', color: '#F7941D' }}>
                        {todayCount}
                    </div>
                </div>
                <div>
                    <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: '#888', marginBottom: 5 }}>
                        This Month
                    </div>
                    <div style={{ fontSize: 36, fontWeight: 'bold', color: '#F7941D' }}>
                        {monthCount}
                    </div>
                </div>
            </div>
            
            <div 
                id="flashOverlay"
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100vw',
                    height: '100vh',
                    background: 'rgba(247, 148, 29, 0.1)',
                    pointerEvents: 'none',
                    opacity: 0,
                    zIndex: 999,
                    transition: 'opacity 0.1s'
                }}
            />
            
            <audio id="cashSound" preload="auto">
                <source src="https://www.soundjay.com/misc/sounds/cash-register-1.mp3" type="audio/mpeg" />
            </audio>
        </>
    );
}
