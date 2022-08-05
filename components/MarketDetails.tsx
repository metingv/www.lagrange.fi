/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import useMangoStore, { SECONDS } from '../stores/useMangoStore'
import usePrevious from '../hooks/usePrevious'
import useInterval from '../hooks/useInterval'
import ChartApi from '../utils/chartDataConnector'
import UiLock from './UiLock'
import useOraclePrice from '../hooks/useOraclePrice'
import DayHighLow from './DayHighLow'
import {
  getPrecisionDigits,
  patchInternalMarketName,
  perpContractPrecision,
  usdFormatter,
} from '../utils'
import { PerpMarket } from '@blockworks-foundation/mango-client'
import BN from 'bn.js'
import { useViewport } from '../hooks/useViewport'
import { useTranslation } from 'next-i18next'
import SwitchMarketDropdown from './SwitchMarketDropdown'

export function calculateFundingRate(perpStats, perpMarket) {
  const oldestStat = perpStats[perpStats.length - 1]
  const latestStat = perpStats[0]

  if (!latestStat || !(perpMarket instanceof PerpMarket)) return 0.0

  // Averaging long and short funding excludes socialized loss
  const startFunding =
    (parseFloat(oldestStat.longFunding) + parseFloat(oldestStat.shortFunding)) /
    2
  const endFunding =
    (parseFloat(latestStat.longFunding) + parseFloat(latestStat.shortFunding)) /
    2
  const fundingDifference = endFunding - startFunding

  const fundingInQuoteDecimals =
    fundingDifference / Math.pow(10, perpMarket.quoteDecimals)

  const avgPrice =
    (parseFloat(latestStat.baseOraclePrice) +
      parseFloat(oldestStat.baseOraclePrice)) /
    2
  const basePriceInBaseLots = avgPrice * perpMarket.baseLotsToNumber(new BN(1))
  return (fundingInQuoteDecimals / basePriceInBaseLots) * 100
}

export function parseOpenInterest(perpMarket: PerpMarket) {
  if (!perpMarket || !(perpMarket instanceof PerpMarket)) return 0

  return perpMarket.baseLotsToNumber(perpMarket.openInterest) / 2
}

const MarketDetails = () => {
  const { t } = useTranslation('common')
  const oraclePrice = useOraclePrice()
  const groupConfig = useMangoStore((s) => s.selectedMangoGroup.config)
  const marketConfig = useMangoStore((s) => s.selectedMarket.config)
  const selectedMarket = useMangoStore((s) => s.selectedMarket.current)
  const baseSymbol = marketConfig.baseSymbol
  const selectedMarketName = marketConfig.name
  const isPerpMarket = marketConfig.kind === 'perp'

  const previousMarketName: string = usePrevious(selectedMarketName)
  const { width } = useViewport()
  const isMobile = width ? width < 800 : false

  const [ohlcv, setOhlcv] = useState(null)
  const [change24h, setChange24h] = useState(0)
  const [, setLoading] = useState(false)
  const [perpStats, setPerpStats] = useState([])
  const [perpVolume, setPerpVolume] = useState(0)

  const fetchMarketInfo = useCallback(async () => {
    const marketInfo = await fetch(
      `https://event-history-api-candles.herokuapp.com/markets/${patchInternalMarketName(
        selectedMarketName
      )}`
    )
    console.log('============', patchInternalMarketName(selectedMarketName))
    const parsedMarketInfo = await marketInfo.json()
    setChange24h(parsedMarketInfo?.change24h)
  }, [selectedMarketName])

  useInterval(() => {
    fetchMarketInfo()
  }, 120 * SECONDS)

  useEffect(() => {
    fetchMarketInfo()
  }, [fetchMarketInfo])

  const fetchPerpStats = useCallback(async () => {
    const urlParams = new URLSearchParams({ mangoGroup: groupConfig.name })
    urlParams.append('market', selectedMarketName)
    const perpStats = await fetch(
      `https://mango-stats-v3.herokuapp.com/perp/funding_rate?` + urlParams
    )
    const parsedPerpStats = await perpStats.json()
    setPerpStats(parsedPerpStats)

    const perpVolume = await fetch(
      `https://event-history-api.herokuapp.com/stats/perps/${marketConfig.publicKey.toString()}`
    )
    const parsedPerpVolume = await perpVolume.json()
    setPerpVolume(parsedPerpVolume?.data?.volume)
  }, [selectedMarketName, marketConfig, groupConfig.name])

  useInterval(() => {
    if (isPerpMarket) {
      fetchPerpStats()
    }
  }, 120 * SECONDS)

  useEffect(() => {
    if (isPerpMarket) {
      fetchPerpStats()
    }
  }, [isPerpMarket, fetchPerpStats])

  const fetchOhlcv = useCallback(async () => {
    if (!selectedMarketName) return

    // calculate from and to date (0:00UTC to 23:59:59UTC)
    const date = new Date()
    const utcFrom = new Date(
      Date.UTC(
        date.getFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        0,
        0,
        0
      )
    )
    const utcTo = new Date(
      Date.UTC(
        date.getFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        23,
        59,
        59
      )
    )

    const from = utcFrom.getTime() / 1000
    const to = utcTo.getTime() / 1000
    const ohlcv = await ChartApi.getOhlcv(selectedMarketName, '1D', from, to)
    if (ohlcv) {
      setOhlcv(ohlcv)
      setLoading(false)
    }
  }, [selectedMarketName])

  // TODO: don't spam db
  // useInterval(async () => {
  //   fetchOhlcv()
  // }, 5000)

  useMemo(() => {
    if (previousMarketName !== selectedMarketName) {
      setLoading(true)
      fetchOhlcv()
    }
  }, [selectedMarketName])

  const funding1h = calculateFundingRate(perpStats, selectedMarket)
  const [funding1hStr, fundingAprStr] = funding1h
    ? [funding1h.toFixed(4), (funding1h * 24 * 365).toFixed(2)]
    : ['-', '-']

  return (
    <div
      className={`flex flex-col relative md:pb-2 md:pt-3 md:px-3 lg:flex-row lg:items-center lg:justify-between`}
    >
      <div className="flex flex-col lg:flex-row lg:items-center">
        <div className="hidden md:block md:pb-4 md:pr-6 lg:pb-0">
          <div className="flex items-center">
            <SwitchMarketDropdown />
          </div>
        </div>
        <div className="grid grid-flow-row grid-cols-1 md:grid-cols-3 gap-3 lg:grid-cols-none lg:grid-flow-col lg:grid-rows-1 lg:gap-6">
          <div className="flex items-center justify-between md:block">
            <div className="text-th-fgd-3 tiny-text pb-0.5">
              {t('oracle-price')}
            </div>
            <div className="text-th-fgd-1 md:text-xs">
              {oraclePrice && selectedMarket
                ? oraclePrice.toNumber().toLocaleString(undefined, {
                    maximumFractionDigits: getPrecisionDigits(
                      selectedMarket.tickSize
                    ),
                  })
                : '--'}
            </div>
          </div>
          <div className="flex items-center justify-between md:block">
            <div className="text-th-fgd-3 tiny-text pb-0.5">
              {t('rolling-change')}
            </div>
            {change24h || change24h === 0 ? (
              <div
                className={`md:text-xs ${
                  change24h > 0
                    ? `text-th-green`
                    : change24h < 0
                    ? `text-th-red`
                    : `text-th-fgd-1`
                }`}
              >
                {(change24h * 100).toFixed(2) + '%'}
              </div>
            ) : (
              <MarketDataLoader />
            )}
          </div>
          {isPerpMarket ? (
            <div className="flex items-center justify-between md:block">
              <div className="text-th-fgd-3 tiny-text pb-0.5">
                {t('daily-volume')}
              </div>
              <div className="text-th-fgd-1 md:text-xs">
                {perpVolume ? (
                  usdFormatter(perpVolume, 0)
                ) : (
                  <MarketDataLoader />
                )}
              </div>
            </div>
          ) : null}
          {isPerpMarket && selectedMarket instanceof PerpMarket ? (
            <>
              <div className="flex items-center justify-between md:block">
                <div className="text-th-fgd-3 tiny-text pb-0.5">
                  {t('open-interest')}
                </div>
                <div className="text-th-fgd-1 md:text-xs">
                  {selectedMarket ? (
                    `${parseOpenInterest(
                      selectedMarket as PerpMarket
                    ).toLocaleString(undefined, {
                      maximumFractionDigits: perpContractPrecision[baseSymbol],
                    })} ${baseSymbol}`
                  ) : (
                    <MarketDataLoader />
                  )}
                </div>
              </div>
            </>
          ) : null}
          <div className="flex items-center justify-between md:block">
            <div className="text-left xl:text-center text-th-fgd-3 tiny-text pb-0.5">
              {t('daily-range')}
            </div>
            <DayHighLow
              high={ohlcv?.h[0]}
              low={ohlcv?.l[0]}
              latest={oraclePrice?.toNumber()}
            />
          </div>
        </div>
      </div>
      {/* <div className="absolute right-0 bottom-0 sm:bottom-auto lg:right-3 flex items-center justify-end space-x-2">
        {!isMobile ? (
          <div id="layout-tip">
            <UiLock />
          </div>
        ) : null}
        <div id="data-refresh-tip"></div>
      </div> */}
    </div>
  )
}

export default MarketDetails

export const MarketDataLoader = () => (
  <div className="animate-pulse bg-th-bkg-3 h-3.5 mt-0.5 w-10 rounded-sm" />
)
