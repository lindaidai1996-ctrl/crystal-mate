'use client';

import { ReloadOutlined } from '@ant-design/icons';
import { App } from 'antd';
import { useLocale } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DateRangeFilter } from '@/components/date-range-filter';
import {
  isMarketDate,
  MARKET_REFRESH_COOLDOWN,
  marketMetals,
  type MarketMetal,
  monthsBefore,
  shanghaiDate,
  METAL_HISTORY_START,
  type MetalHistory,
  type MetalQuote,
} from '@/lib/metal-market';
import { getMarketCopy } from './copy';
import { MetalChart } from './metal-chart';
import marketStyles from './metal-market.module.css';

class MarketRequestError extends Error {
  constructor(public retryAfter: number) {
    super('RATE_LIMITED');
  }
}

async function getMarket<T>(query: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/public/metal-price?${query}`, {
    signal,
    cache: 'no-store',
    credentials: 'omit',
  });
  if (response.status === 429) {
    const seconds = Number(response.headers.get('Retry-After'));
    throw new MarketRequestError(Number.isFinite(seconds) && seconds > 0 ? seconds : 60);
  }
  if (!response.ok) throw new Error('MARKET_UNAVAILABLE');
  return response.json();
}

export function MetalMarket({ today, initialMetal }: { today: string; initialMetal: MarketMetal }) {
  const [metal, setMetal] = useState(initialMetal);
  const deadline = useRef(0);
  const [cooldown, setCooldown] = useState(0);
  const startCooldown = useCallback((seconds: number) => {
    deadline.current = Math.max(deadline.current, Date.now() + seconds * 1000);
    setCooldown(Math.ceil((deadline.current - Date.now()) / 1000));
  }, []);
  const manualRefresh = useCallback(
    (refresh: () => void) => {
      if (Date.now() < deadline.current) return;
      startCooldown(MARKET_REFRESH_COOLDOWN / 1000);
      refresh();
    },
    [startCooldown],
  );
  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setInterval(() => {
      setCooldown(Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000)));
    }, 250);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  function selectMetal(next: MarketMetal) {
    if (next === metal) return;
    setMetal(next);
    const url = new URL(window.location.href);
    if (next === 'silver') url.searchParams.delete('metal');
    else url.searchParams.set('metal', next);
    window.history.replaceState(null, '', url);
  }

  return (
    <MetalMarketView
      key={metal}
      today={today}
      metal={metal}
      selectMetal={selectMetal}
      cooldown={cooldown}
      manualRefresh={manualRefresh}
      startCooldown={startCooldown}
    />
  );
}

function MetalMarketView({
  today: initialToday,
  metal,
  selectMetal,
  cooldown,
  manualRefresh,
  startCooldown,
}: {
  today: string;
  metal: MarketMetal;
  selectMetal: (metal: MarketMetal) => void;
  cooldown: number;
  manualRefresh: (refresh: () => void) => void;
  startCooldown: (seconds: number) => void;
}) {
  const isEnglish = useLocale() === 'en';
  const copy = useMemo(() => getMarketCopy(isEnglish ? 'en' : 'zh', metal), [isEnglish, metal]);
  const instrument = marketMetals[metal];
  const [limited, setLimited] = useState(false);
  const { message } = App.useApp();
  const lastQuote = useRef<MetalQuote | null>(null);
  const [range, setRange] = useState({ from: monthsBefore(initialToday, 3), to: initialToday });
  const [invalid, setInvalid] = useState(false);
  const [preset, setPreset] = useState<number | null>(3);
  const [quoteRevision, setQuoteRevision] = useState(0);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [quote, setQuote] = useState<{
    data: MetalQuote | null;
    loading: boolean;
    error: boolean;
  }>({ data: null, loading: true, error: false });
  const [history, setHistory] = useState<{
    data: MetalHistory | null;
    loading: boolean;
    error: boolean;
  }>({ data: null, loading: true, error: false });

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const controller = new AbortController();
    const feedbackKey = 'metal-market-refresh';
    let nextRefreshAt = 0;
    async function refresh(manual = false) {
      if (inFlight || Date.now() < nextRefreshAt) return;
      inFlight = true;
      const signal = controller.signal;
      setQuote((current) => ({ ...current, loading: true }));
      if (manual)
        void message.open({
          key: feedbackKey,
          type: 'loading',
          content: copy.refreshing,
          duration: 0,
        });
      try {
        const data = await getMarket<MetalQuote>(`metal=${metal}&view=quote`, signal);
        if (active && !signal.aborted) {
          setLimited(false);
          const unchanged = lastQuote.current?.price === data.price;
          lastQuote.current = data;
          setQuote({ data, loading: false, error: false });
          if (manual)
            void message.open({
              key: feedbackKey,
              type: 'success',
              content: unchanged ? copy.refreshUnchanged : copy.refreshDone,
              duration: 2.5,
            });
        }
      } catch (error) {
        if (active && !signal.aborted) {
          const rateLimited = error instanceof MarketRequestError;
          nextRefreshAt =
            Date.now() + (rateLimited ? error.retryAfter * 1000 : MARKET_REFRESH_COOLDOWN);
          if (rateLimited) startCooldown(error.retryAfter);
          setLimited(rateLimited);
          setQuote((current) => ({ ...current, loading: false, error: true }));
          if (manual)
            void message.open({
              key: feedbackKey,
              type: 'error',
              content: error instanceof MarketRequestError ? copy.limited : copy.failed,
              duration: 3,
            });
        }
      } finally {
        inFlight = false;
      }
    }
    void refresh(quoteRevision > 0);
    const visibleRefresh = () => {
      if (!document.hidden) void refresh();
    };
    const timer = window.setInterval(visibleRefresh, 30_000);
    document.addEventListener('visibilitychange', visibleRefresh);
    return () => {
      active = false;
      controller.abort();
      message.destroy(feedbackKey);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visibleRefresh);
    };
  }, [quoteRevision, message, copy, metal, startCooldown]);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    let inFlight = false;
    let nextRefreshAt = 0;
    async function refresh() {
      if (inFlight || Date.now() < nextRefreshAt) return;
      inFlight = true;
      setHistory({ data: null, loading: true, error: false });
      try {
        const data = await getMarket<MetalHistory>(
          `metal=${metal}&view=history&from=${range.from}&to=${range.to}`,
          signal,
        );
        if (!signal.aborted) setHistory({ data, loading: false, error: false });
      } catch (error) {
        if (!signal.aborted) {
          if (error instanceof MarketRequestError) {
            nextRefreshAt = Date.now() + error.retryAfter * 1000;
            startCooldown(error.retryAfter);
            setLimited(true);
          }
          setHistory({ data: null, loading: false, error: true });
        }
      } finally {
        inFlight = false;
      }
    }
    const debounce = window.setTimeout(() => void refresh(), 300);
    const timer = window.setInterval(() => {
      if (!document.hidden && range.to === shanghaiDate()) void refresh();
    }, 300_000);
    return () => {
      controller.abort();
      window.clearTimeout(debounce);
      window.clearInterval(timer);
    };
  }, [range, historyRevision, metal, startCooldown]);

  function selectPreset(months: number) {
    const today = shanghaiDate();
    const next = {
      from: months === 0 ? METAL_HISTORY_START : monthsBefore(today, months),
      to: today,
    };
    setRange((current) => (current.from === next.from && current.to === next.to ? current : next));
    setPreset(months);
    setInvalid(false);
  }

  const data = quote.data;
  const formatPrice = (price: number | null) => (price === null ? '—' : price.toFixed(3));
  const updated = data
    ? new Intl.DateTimeFormat(isEnglish ? 'en-GB' : 'zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(data.updatedAt))
    : null;
  const signed = (value: number, digits: number) =>
    `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
  const historyMatches = history.data?.from === range.from && history.data?.to === range.to;

  return (
    <main className={marketStyles.screen}>
      <div className={marketStyles.atmosphere} aria-hidden="true" />
      <header className={marketStyles.header}>
        <div className={marketStyles.brand}>
          <span className={marketStyles.logo} aria-hidden="true" />
          <div>
            <strong>
              祝余 <span>IWISH</span>
            </strong>
            <small>CRYSTAL MATE</small>
          </div>
        </div>
        <div className={marketStyles.headerActions}>
          <span className={marketStyles.marketLabel}>
            {metal === 'gold' ? 'GOLD MARKET' : 'SILVER MARKET'}
          </span>
          <a
            href={`/yj?metal=${metal}${isEnglish ? '' : '&lang=en'}`}
            lang={isEnglish ? 'zh-CN' : 'en'}
          >
            {isEnglish ? '中文' : 'English'}
          </a>
        </div>
      </header>
      <div className={marketStyles.content}>
        <section className={marketStyles.current} aria-labelledby="metal-title">
          <p className={marketStyles.eyebrow}>
            IWISH · DAILY {metal === 'gold' ? 'GOLD' : 'SILVER'}
          </p>
          <div className={marketStyles.titleRow}>
            <h1 id="metal-title">{copy.title}</h1>
            <div className={marketStyles.metalSwitch} role="group" aria-label={copy.switchMetal}>
              {(['silver', 'gold'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={metal === value}
                  onClick={() => selectMetal(value)}
                >
                  {copy[value]}
                </button>
              ))}
            </div>
          </div>
          <p className={marketStyles.subtitle}>{copy.subtitle}</p>
          <p className={marketStyles.description}>{copy.description}</p>
          <div className={marketStyles.quoteCard} aria-busy={quote.loading}>
            <div className={marketStyles.cardTop}>
              <span>
                <i />
                {copy.latest}
              </span>
              <button
                type="button"
                onClick={() => manualRefresh(() => setQuoteRevision((value) => value + 1))}
                disabled={quote.loading || cooldown > 0}
                title={cooldown ? `${cooldown} ${copy.cooldown}` : copy.refresh}
                aria-label={cooldown ? `${cooldown} ${copy.cooldown}` : copy.refresh}
              >
                <span aria-hidden="true">
                  {cooldown && !quote.loading ? (
                    `${cooldown}s`
                  ) : (
                    <ReloadOutlined spin={quote.loading} />
                  )}
                </span>
              </button>
            </div>
            <p className={marketStyles.instrument}>
              {instrument.instrument}
              <span>
                {isEnglish
                  ? 'Shanghai Gold Exchange'
                  : `上海黄金交易所 · ${metal === 'gold' ? '黄金' : '白银'}延期`}
              </span>
            </p>
            {data ? (
              <>
                <div className={marketStyles.price}>
                  <span>¥</span>
                  <strong>{formatPrice(data.price)}</strong>
                  <small>{copy.gram}</small>
                </div>
                <div
                  className={`${marketStyles.change} ${data.change > 0 ? marketStyles.up : data.change < 0 ? marketStyles.down : ''}`}
                >
                  <span>{signed(data.change, 3)}</span>
                  <span>{signed(data.changePercent, 2)}%</span>
                  <small>{copy.versus}</small>
                </div>
                <p className={marketStyles.kilo}>
                  ¥
                  {(data.price * 1000).toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  {copy.kilogram}
                </p>
                <dl className={marketStyles.quoteStats}>
                  {(
                    [
                      [copy.open, data.open],
                      [copy.previous, data.previousClose],
                      [copy.high, data.high],
                      [copy.low, data.low],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{formatPrice(value)}</dd>
                    </div>
                  ))}
                </dl>
                <div className={marketStyles.updated}>
                  <div className={marketStyles.updatedHeading}>
                    <span>{copy.refreshed}</span>
                    <span className={marketStyles.auto}>
                      <i />
                      {copy.auto}
                    </span>
                  </div>
                  <div className={marketStyles.updatedTime}>
                    <time dateTime={data.updatedAt}>{updated}</time>
                    <small>{copy.timezone}</small>
                  </div>
                </div>
              </>
            ) : (
              <div className={marketStyles.quoteState} role="status">
                {quote.error ? (limited ? copy.limited : copy.failed) : copy.loading}
                {quote.error && (
                  <button
                    type="button"
                    disabled={quote.loading || cooldown > 0}
                    onClick={() => manualRefresh(() => setQuoteRevision((value) => value + 1))}
                  >
                    {copy.retry}
                  </button>
                )}
              </div>
            )}
            {data && quote.error && (
              <p className={marketStyles.error} role="status">
                {copy.stale}
              </p>
            )}
          </div>
        </section>
        <section className={marketStyles.historyCard} aria-labelledby="history-title">
          <div className={marketStyles.historyHeading}>
            <div>
              <p className={marketStyles.eyebrow}>THE LONGER VIEW</p>
              <h2 id="history-title">{copy.history}</h2>
            </div>
            <span>{copy.daily}</span>
          </div>
          <div className={marketStyles.presets} aria-label={copy.history}>
            {(
              [
                [1, copy.month],
                [3, copy.quarter],
                [6, copy.half],
                [12, copy.year],
                [36, copy.years],
                [0, copy.all],
              ] as const
            ).map(([months, label]) => (
              <button
                type="button"
                key={months}
                aria-pressed={preset === months}
                onClick={() => selectPreset(months)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={marketStyles.dateRange}>
            <DateRangeFilter
              kind="received"
              label={copy.dateRange}
              endpointLabels={[copy.startDate, copy.endDate]}
              value={[range.from, range.to]}
              onChange={(next) => {
                if (!next) {
                  selectPreset(0);
                  return;
                }
                const [from, to] = next;
                if (
                  !isMarketDate(from) ||
                  !isMarketDate(to) ||
                  from < METAL_HISTORY_START ||
                  to > shanghaiDate() ||
                  from > to
                ) {
                  setInvalid(true);
                  return;
                }
                setInvalid(false);
                setPreset(null);
                setRange({ from, to });
              }}
            />
          </div>
          {limited && cooldown > 0 && (
            <p className={marketStyles.error} role="status">
              {copy.limited} ({cooldown}s)
            </p>
          )}
          {invalid && (
            <p className={marketStyles.error} role="alert">
              {copy.invalid}
            </p>
          )}
          <div aria-busy={history.loading}>
            {history.error ? (
              <div className={marketStyles.chartState} role="status">
                <p>{copy.historyFailed}</p>
                <button
                  type="button"
                  disabled={history.loading || cooldown > 0}
                  onClick={() => manualRefresh(() => setHistoryRevision((value) => value + 1))}
                >
                  {copy.retry}
                </button>
              </div>
            ) : !historyMatches ? (
              <div className={marketStyles.chartState} role="status">
                <span className={marketStyles.loadingLine} />
                <p>{copy.historyLoading}</p>
              </div>
            ) : !history.data!.points.length ? (
              <div className={marketStyles.chartState} role="status">
                {copy.empty}
              </div>
            ) : (
              <MetalChart
                key={`${range.from}-${range.to}`}
                points={history.data!.points}
                copy={copy}
              />
            )}
          </div>
        </section>
      </div>
      <div className={marketStyles.bottom}>
        <div>
          <p>
            <a
              href={`https://quote.eastmoney.com/globalfuture/${instrument.code}.html`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {copy.source}
            </a>
          </p>
          <p>{copy.note}</p>
        </div>
        <span>{copy.signature}</span>
      </div>
    </main>
  );
}
