import { createContext, useContext, useState, type ReactNode } from 'react'
import { type Farmer, getFarmerProfile } from '../api/client'

interface FarmerContextType {
  farmer: Farmer | null
  setFarmer: (f: Farmer | null) => void
  refreshFarmer: () => Promise<void>
}

const FarmerContext = createContext<FarmerContextType | undefined>(undefined)

export function FarmerProvider({ children }: { children: ReactNode }) {
  const [farmer, setFarmer] = useState<Farmer | null>(null)

  const refreshFarmer = async () => {
    if (!farmer) return
    try {
      const updated = await getFarmerProfile(farmer.national_id)
      setFarmer(updated)
    } catch (e) {
      console.error('Failed to refresh farmer profile:', e)
    }
  }

  return (
    <FarmerContext.Provider value={{ farmer, setFarmer, refreshFarmer }}>
      {children}
    </FarmerContext.Provider>
  )
}

export function useFarmer() {
  const context = useContext(FarmerContext)
  if (context === undefined) {
    throw new Error('useFarmer must be used within a FarmerProvider')
  }
  return context
}
