import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { User, Loader2, MapPin, Swords, Package } from "lucide-react"
import { loadCharacterStates, type CharacterState } from "@/lib/novel/character-state"
import { loadCognitionState, type CognitionState } from "@/lib/novel/character-cognition"

export function CharacterProfile({ characterName, projectPath }: { characterName: string; projectPath: string }) {
  const { t } = useTranslation()
  const [charState, setCharState] = useState<CharacterState | null>(null)
  const [cognition, setCognition] = useState<CognitionState | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      loadCharacterStates(projectPath),
      loadCognitionState(projectPath),
    ]).then(([chars, cog]) => {
      setCharState(chars.characters.find(c => c.characterName === characterName) ?? null)
      setCognition(cog)
    }).catch(() => {
      setCharState(null)
      setCognition(null)
    }).finally(() => setLoading(false))
  }, [characterName, projectPath])

  const charCognition = cognition?.characters.find(c => c.character === characterName)

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4 p-3 text-sm">
      <div className="flex items-center gap-2">
        <User className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold">{characterName}</h3>
      </div>

      {charState ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border p-2">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {t("novel.character.location")}
              </div>
              <p className="mt-1 font-medium">{charState.currentLocation || t("novel.character.unknown")}</p>
            </div>
            <div className="rounded-md border p-2">
              <div className="text-xs text-muted-foreground">{t("novel.character.status")}</div>
              <p className="mt-1 font-medium">{charState.status || t("novel.character.unknown")}</p>
            </div>
          </div>

          {charState.equipment.length > 0 && (
            <div className="rounded-md border p-2">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Package className="h-3 w-3" />
                {t("novel.character.equipment")}
              </div>
              <p className="mt-1">{charState.equipment.join("、")}</p>
            </div>
          )}

          {charState.abilities.length > 0 && (
            <div className="rounded-md border p-2">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Swords className="h-3 w-3" />
                {t("novel.character.abilities")}
              </div>
              <p className="mt-1">{charState.abilities.join("、")}</p>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("novel.character.noStateData")}</p>
      )}

      {charCognition ? (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground">{t("novel.cognition.title")}</h4>
          {charCognition.knows.length > 0 && (
            <div className="rounded-md border border-green-200 bg-green-50 p-2 dark:border-green-800 dark:bg-green-950">
              <p className="text-xs font-medium text-green-700 dark:text-green-400">{t("novel.cognition.knows")}</p>
              <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                {charCognition.knows.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </div>
          )}
          {charCognition.doesNotKnow.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2 dark:border-red-800 dark:bg-red-950">
              <p className="text-xs font-medium text-red-700 dark:text-red-400">{t("novel.cognition.doesNotKnow")}</p>
              <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                {charCognition.doesNotKnow.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}