import React, { createContext, useContext, useEffect, useState } from "react";

const SpaceContext = createContext(null);

// A stable per-device identifier so chat can distinguish "me" from "partner".
function getDeviceId() {
  let id = localStorage.getItem("we2gether_device");
  if (!id) {
    id = "dev_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("we2gether_device", id);
  }
  return id;
}

export function SpaceProvider({ children }) {
  const [code, setCode] = useState(() => localStorage.getItem("we2gether_code") || null);
  const [deviceId] = useState(getDeviceId);

  useEffect(() => {
    if (code) localStorage.setItem("we2gether_code", code);
    else localStorage.removeItem("we2gether_code");
  }, [code]);

  const disconnect = () => setCode(null);

  return (
    <SpaceContext.Provider value={{ code, setCode, deviceId, disconnect }}>
      {children}
    </SpaceContext.Provider>
  );
}

export const useSpace = () => useContext(SpaceContext);
