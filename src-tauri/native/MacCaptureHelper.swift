import AVFoundation
import CoreGraphics
import CoreMedia
import Foundation
import ScreenCaptureKit

struct PermissionStatus: Codable {
    let screenRecordingGranted: Bool
    let microphoneGranted: Bool
}

enum HelperError: Error, CustomStringConvertible {
    case invalidArguments(String)
    case noDisplayAvailable
    case streamUnavailable
    case timedOut

    var description: String {
        switch self {
        case let .invalidArguments(message):
            return message
        case .noDisplayAvailable:
            return "No display is available for ScreenCaptureKit content filtering."
        case .streamUnavailable:
            return "Capture stream is unavailable."
        case .timedOut:
            return "Timed out while waiting for capture to stop."
        }
    }
}

final class AudioCaptureCoordinator: NSObject, SCStreamOutput, SCStreamDelegate {
    private let micOutputPath: String
    private let systemOutputPath: String
    private let systemQueue = DispatchQueue(label: "meeting.transcriber.capture.system")
    private let micQueue = DispatchQueue(label: "meeting.transcriber.capture.mic")
    private let whisperFormat = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: 16_000,
        channels: 1,
        interleaved: false
    )!

    private var stream: SCStream?
    private var systemFile: AVAudioFile?
    private var micFile: AVAudioFile?
    private var stopContinuation: CheckedContinuation<Void, Never>?
    private var hasSignaledStop = false

    init(micOutputPath: String, systemOutputPath: String) {
        self.micOutputPath = micOutputPath
        self.systemOutputPath = systemOutputPath
    }

    func run() async throws {
        let sharableContent = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = sharableContent.displays.first else {
            throw HelperError.noDisplayAvailable
        }

        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        let configuration = SCStreamConfiguration()
        configuration.width = 2
        configuration.height = 2
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        configuration.queueDepth = 1
        configuration.capturesAudio = true
        configuration.captureMicrophone = true
        configuration.sampleRate = 16_000
        configuration.channelCount = 1
        configuration.excludesCurrentProcessAudio = true

        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: systemQueue)
        try stream.addStreamOutput(self, type: .microphone, sampleHandlerQueue: micQueue)
        self.stream = stream

        try await stream.startCapture()
        print("{\"status\":\"ready\"}")
        fflush(stdout)

        let stopTask = Task.detached {
            while let line = readLine(strippingNewline: true) {
                if line == "stop" {
                    return
                }
            }
        }

        await withCheckedContinuation { continuation in
            self.stopContinuation = continuation
            Task.detached {
                _ = await stopTask.result
                self.signalStop()
            }
        }

        try await stopCapture()
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        fputs("capture stopped with error: \(error)\n", stderr)
        signalStop()
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard sampleBuffer.isValid else {
            return
        }

        do {
            try sampleBuffer.withAudioBufferList { audioBufferList, _ in
                guard let description = sampleBuffer.formatDescription?.audioStreamBasicDescription else {
                    return
                }

                let format = AVAudioFormat(
                    commonFormat: .pcmFormatFloat32,
                    sampleRate: description.mSampleRate,
                    channels: description.mChannelsPerFrame,
                    interleaved: false
                )

                guard let format, let pcmBuffer = AVAudioPCMBuffer(
                    pcmFormat: format,
                    bufferListNoCopy: audioBufferList.unsafePointer
                ) else {
                    return
                }

                switch outputType {
                case .audio:
                    try self.write(buffer: pcmBuffer, to: &self.systemFile, outputPath: self.systemOutputPath)
                case .microphone:
                    try self.write(buffer: pcmBuffer, to: &self.micFile, outputPath: self.micOutputPath)
                default:
                    break
                }
            }
        } catch {
            fputs("failed to process audio buffer: \(error)\n", stderr)
        }
    }

    private func write(buffer: AVAudioPCMBuffer, to audioFile: inout AVAudioFile?, outputPath: String) throws {
        let normalized = try normalizeForWhisper(buffer)

        if audioFile == nil {
            audioFile = try AVAudioFile(
                forWriting: URL(fileURLWithPath: outputPath),
                settings: whisperFormat.settings,
                commonFormat: whisperFormat.commonFormat,
                interleaved: whisperFormat.isInterleaved
            )
        }

        try audioFile?.write(from: normalized)
    }

    private func normalizeForWhisper(_ buffer: AVAudioPCMBuffer) throws -> AVAudioPCMBuffer {
        if buffer.format.sampleRate == whisperFormat.sampleRate
            && buffer.format.channelCount == whisperFormat.channelCount
            && buffer.format.commonFormat == whisperFormat.commonFormat
        {
            return buffer
        }

        guard let converter = AVAudioConverter(from: buffer.format, to: whisperFormat) else {
            throw HelperError.invalidArguments("Failed to create audio converter for Whisper output.")
        }

        let ratio = whisperFormat.sampleRate / buffer.format.sampleRate
        let frameCapacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * ratio)) + 32
        guard let output = AVAudioPCMBuffer(pcmFormat: whisperFormat, frameCapacity: frameCapacity) else {
            throw HelperError.invalidArguments("Failed to allocate converted audio buffer.")
        }

        var consumedInput = false
        var conversionError: NSError?
        let status = converter.convert(to: output, error: &conversionError) { _, inputStatus in
            if consumedInput {
                inputStatus.pointee = .noDataNow
                return nil
            }
            consumedInput = true
            inputStatus.pointee = .haveData
            return buffer
        }

        if status == .error {
            throw conversionError ?? HelperError.invalidArguments("Audio conversion failed.")
        }

        return output
    }

    private func signalStop() {
        guard !hasSignaledStop else {
            return
        }

        hasSignaledStop = true
        stopContinuation?.resume()
        stopContinuation = nil
    }

    private func stopCapture() async throws {
        guard let stream else {
            throw HelperError.streamUnavailable
        }

        try await stream.stopCapture()
        systemFile = nil
        micFile = nil
        print("{\"status\":\"stopped\"}")
        fflush(stdout)
    }
}

func microphonePermissionStatus() -> Bool {
    AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
}

func requestMicrophonePermission() async -> Bool {
    await withCheckedContinuation { continuation in
        AVCaptureDevice.requestAccess(for: .audio) { granted in
            continuation.resume(returning: granted)
        }
    }
}

func screenPermissionStatus() -> Bool {
    CGPreflightScreenCaptureAccess()
}

func requestScreenPermission() -> Bool {
    CGRequestScreenCaptureAccess()
}

func printJSON<T: Encodable>(_ value: T) throws {
    let encoder = JSONEncoder()
    let data = try encoder.encode(value)
    guard let json = String(data: data, encoding: .utf8) else {
        throw HelperError.invalidArguments("Failed to encode JSON output.")
    }

    print(json)
}

func parseOption(_ flag: String, arguments: [String]) -> String? {
    guard let index = arguments.firstIndex(of: flag), arguments.count > index + 1 else {
        return nil
    }

    return arguments[index + 1]
}

@main
struct MacCaptureHelper {
    static func main() async {
        do {
            let arguments = CommandLine.arguments
            guard arguments.count >= 2 else {
                throw HelperError.invalidArguments("Expected a subcommand.")
            }

            switch arguments[1] {
            case "permission-status":
                try printJSON(PermissionStatus(
                    screenRecordingGranted: screenPermissionStatus(),
                    microphoneGranted: microphonePermissionStatus()
                ))

            case "request-permissions":
                let screenGranted = screenPermissionStatus() || requestScreenPermission()
                let micGranted = microphonePermissionStatus() ? true : await requestMicrophonePermission()
                try printJSON(PermissionStatus(
                    screenRecordingGranted: screenGranted,
                    microphoneGranted: micGranted
                ))

            case "capture":
                guard
                    let micOutput = parseOption("--mic-output", arguments: arguments),
                    let systemOutput = parseOption("--system-output", arguments: arguments)
                else {
                    throw HelperError.invalidArguments(
                        "capture requires --mic-output <path> and --system-output <path>"
                    )
                }

                let coordinator = AudioCaptureCoordinator(
                    micOutputPath: micOutput,
                    systemOutputPath: systemOutput
                )

                try await coordinator.run()

            default:
                throw HelperError.invalidArguments("Unknown subcommand: \(arguments[1])")
            }
        } catch {
            fputs("\(error)\n", stderr)
            exit(1)
        }
    }
}
