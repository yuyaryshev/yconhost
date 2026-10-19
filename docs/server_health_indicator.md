# Server Health Indicator

The browser probes /api/health every 300 ms. Both the request timeout and the offline silence deadline are 2.2 intervals (660 ms).

A successful response turns the indicator green and resets the silence deadline. Failed requests do not immediately turn it red: an older failed request must not override a newer successful probe. The indicator turns red only after 660 ms without a successful response. Pending requests and timers are canceled when the component unmounts.

Previously, requests were aborted after 250 ms, less than the 300 ms probe interval, and every failure immediately turned the indicator red. This caused flickering during short delays.
