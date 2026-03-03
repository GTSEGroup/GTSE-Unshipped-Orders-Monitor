import { NextResponse } from 'next/server';

// Server-side cache shared across all clients
let cachedOrders: ReturnType<typeof processOrders> = [];
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Always fetch from start of today — client-side knownOrderIds handles deduplication
function getStartOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

interface BigCommerceOrder {
    id: number;
    date_created: string;
    status: string;
    total_inc_tax: string;
    billing_address?: {
        zip?: string;
        city?: string;
        country?: string;
    };
}

function processOrders(orders: BigCommerceOrder[]) {
    return (orders || []).map((order) => ({
        id: order.id,
        date_created: order.date_created,
        status: order.status,
        total: order.total_inc_tax,
        billing_address: order.billing_address ? {
            zip: order.billing_address.zip,
            city: order.billing_address.city,
            country: order.billing_address.country
        } : null
    }));
}

export async function GET() {
    try {
        const now = Date.now();

        // Return cached data if still fresh AND still same day
        const cacheDate = new Date(cacheTimestamp).toDateString();
        const todayDate = new Date().toDateString();
        const cacheStillToday = cacheDate === todayDate;

        if (cacheStillToday && now - cacheTimestamp < CACHE_TTL_MS) {
            return NextResponse.json({
                orders: cachedOrders,
                count: cachedOrders.length,
                lastCheck: new Date(cacheTimestamp).toISOString(),
                cached: true,
            });
        }

        const storeHash = process.env.BIGCOMMERCE_UK_STORE_HASH;
        const accessToken = process.env.BIGCOMMERCE_UK_ACCESS_TOKEN;

        if (!storeHash || !accessToken) {
            return NextResponse.json({
                error: 'BigCommerce credentials not configured',
                orders: []
            });
        }

        // Always fetch from midnight today — full day's orders, client deduplicates
        const minDateCreated = getStartOfToday().toISOString();

        // Fetch orders from BigCommerce
        const url = `https://api.bigcommerce.com/stores/${storeHash}/v2/orders?min_date_created=${encodeURIComponent(minDateCreated)}&sort=date_created:desc&limit=50`;

        const response = await fetch(url, {
            headers: {
                'X-Auth-Token': accessToken,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            next: { revalidate: 0 }
        });

        // BC returns 204 No Content when no orders match — not an error
        if (response.status === 204) {
            cachedOrders = [];
            cacheTimestamp = now;
            return NextResponse.json({ orders: [], count: 0, lastCheck: new Date().toISOString(), cached: false });
        }

        if (!response.ok) {
            console.error('BigCommerce API error:', response.status);
            return NextResponse.json({ orders: [], error: `API error: ${response.status}` });
        }

        const orders = await response.json();

        // Process and cache
        cachedOrders = processOrders(orders);
        cacheTimestamp = now;

        return NextResponse.json({
            orders: cachedOrders,
            count: cachedOrders.length,
            lastCheck: new Date().toISOString(),
            cached: false,
        });

    } catch (error) {
        console.error('Error fetching orders:', error);
        return NextResponse.json({ orders: [], error: String(error) });
    }
}
