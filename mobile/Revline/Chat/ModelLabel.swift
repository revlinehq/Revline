import Foundation

func modelLabel(_ value: String) -> String {
    switch value {
    case "gpt-6.1-sol": "GPT-6.1 Sol"
    case "gpt-6-astra": "GPT-6 Astra"
    case "gpt-6.1-terra": "GPT-6.1 Terra"
    case "sonnet": "Sonnet 5.5"
    case "opus": "Opus 5.5"
    case "gemini-4-argon": "Gemini 4 Argon"
    default: value
    }
}
