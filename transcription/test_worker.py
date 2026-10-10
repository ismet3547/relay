import unittest
from worker import JobError, align_segments, validate_probe, validate_utterance_probe


class MediaValidationTests(unittest.TestCase):
    def test_microphone_webm_without_duration_is_decoded_before_duration_check(self):
        self.assertIsNone(validate_utterance_probe({"streams": [{"codec_type": "audio"}]}))
        with self.assertRaises(JobError):
            validate_utterance_probe({"streams": [{"codec_type": "audio"}]}, require_duration=True)

    def test_utterances_require_audio_and_bounded_real_duration(self):
        self.assertEqual(validate_utterance_probe({"streams": [{"codec_type": "audio"}], "format": {"duration": "4.5"}}), 4.5)
        for duration in ("nan", "inf", "-1", "0", "31"):
            with self.assertRaises(JobError):
                validate_utterance_probe({"streams": [{"codec_type": "audio"}], "format": {"duration": duration}})
        with self.assertRaises(JobError):
            validate_utterance_probe({"streams": [{"codec_type": "video"}], "format": {"duration": "4"}})

    def probe(self, duration="11", audio=True, width=1280):
        streams = [{"codec_type": "video", "width": width, "height": 720, "codec_name": "h264"}]
        if audio:
            streams.append({"codec_type": "audio", "codec_name": "aac"})
        return {"format": {"duration": duration}, "streams": streams}

    def test_actual_audio_and_video_metadata(self):
        self.assertEqual(validate_probe(self.probe())["duration"], 11)

    def test_missing_audio_is_not_a_silent_fake_transcript(self):
        with self.assertRaises(JobError) as result:
            validate_probe(self.probe(audio=False))
        self.assertEqual(result.exception.code, "NO_AUDIO")

    def test_duration_and_decode_dimensions_are_bounded(self):
        for value in ("nan", "inf", "-1", "0", "1801"):
            with self.assertRaises(JobError):
                validate_probe(self.probe(duration=value))
        with self.assertRaises(JobError):
            validate_probe(self.probe(width=10000))

    def test_recognizer_timestamps_are_preserved(self):
        result = align_segments([{"start": 3.12, "end": 5.43, "text": " Hello "}], 11)
        self.assertEqual(result, [{"id": 0, "start": 3.12, "end": 5.43, "text": "Hello"}])

    def test_invalid_overlapping_and_out_of_bounds_timestamps_fail(self):
        for start, end in [(-1, 2), (2, 1), (float("nan"), 2), (1, float("inf")), (10, 20)]:
            with self.assertRaises(JobError):
                align_segments([{"start": start, "end": end, "text": "Hello"}], 11)
        with self.assertRaises(JobError):
            align_segments([{"start": 1, "end": 4, "text": "A"}, {"start": 3, "end": 6, "text": "B"}], 11)

    def test_no_speech_returns_a_clear_error(self):
        with self.assertRaises(JobError) as result:
            align_segments([], 11)
        self.assertEqual(result.exception.code, "NO_SPEECH")


if __name__ == "__main__":
    unittest.main()
