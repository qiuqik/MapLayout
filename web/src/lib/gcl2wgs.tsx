import React from 'react';

// 定义坐标类型
export type Coordinate = {
  lng: number; // 经度
  lat: number; // 纬度
};

/**
 * 判断坐标是否在中国境内，非境内坐标不做偏移修正
 * @param lng 经度
 * @param lat 纬度
 * @returns 是否在境外
 */
const isOutOfChina = (lng: number, lat: number): boolean => {
  return !(73.66 < lng && lng < 135.05 && 3.86 < lat && lat < 53.55);
};

/**
 * 计算纬度偏移量（内部辅助函数）
 */
const transformLat = (x: number, y: number): number => {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
  return ret;
};

/**
 * 计算经度偏移量（内部辅助函数）
 */
const transformLng = (x: number, y: number): number => {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
  return ret;
};

/**
 * GCJ-02(高德坐标系) 转 WGS84(Mapbox坐标系)
 * @param gcjCoord 高德坐标 {lng: 经度, lat: 纬度}
 * @returns WGS84坐标 {lng: 经度, lat: 纬度}
 */
export const gcj02ToWgs84 = (gcjCoord: [number, number]): [number, number] => {
  const [gcjLng, gcjLat] = gcjCoord;
  
  // 非中国境内坐标直接返回原坐标
  if (isOutOfChina(gcjLng, gcjLat)) {
    return [gcjLng, gcjLat];
  }

  const A = 6378245.0; // 长半轴
  const EE = 0.00669342162296594323; // 偏心率平方

  // 计算偏移量
  const dLat = transformLat(gcjLng - 105.0, gcjLat - 35.0);
  const dLng = transformLng(gcjLng - 105.0, gcjLat - 35.0);
  const radLat = gcjLat / 180.0 * Math.PI;
  const magic = Math.sin(radLat);
  const magic2 = 1 - EE * magic * magic;
  const sqrtMagic2 = Math.sqrt(magic2);
  
  // 还原WGS84坐标
  const wgs84Lat = gcjLat - (dLat * 180.0) / ((A * (1 - EE)) / (magic2 * sqrtMagic2) * Math.PI);
  const wgs84Lng = gcjLng - (dLng * 180.0) / (A / sqrtMagic2 * Math.cos(radLat) * Math.PI);

  return [parseFloat(wgs84Lng.toFixed(6)), parseFloat(wgs84Lat.toFixed(6))];
};