package com.example.sources;

import org.springframework.boot.CommandLineRunner;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * A generic fixture exercising ONE of EACH source kind the Spring enumerator
 * must detect (the Pug-class completeness contract): HTTP endpoint, scheduled,
 * queue-listener, websocket-mapping, event-listener, and app-entry. It ALSO
 * carries the NON-HTTP `@*Mapping` pollution the allow-list must EXCLUDE
 * (`@SqlResultSetMapping`, MapStruct `@Mapping`, `@ConstructorResult`) so the
 * exclusion is asserted RED-on-regression too. No business terms — generic.
 */
@SqlResultSetMapping(name = "noop")
class SourceKinds implements CommandLineRunner {

  // app-entry (best-effort): a process entry point.
  public static void main(String[] args) {
    System.out.println("start");
  }

  // app-entry (best-effort): CommandLineRunner.run runs on startup.
  @Override
  public void run(String... args) {
    // no-op
  }

  // HTTP endpoint — the only `@*Mapping` that should be classified `endpoint`.
  @GetMapping("/widgets")
  public String listWidgets() {
    return "ok";
  }

  // scheduled — a flow starts on a timer.
  @Scheduled(cron = "0 0 * * * *")
  public void sweep() {
    // periodic job
  }

  // queue-listener — a message-consumer entry point.
  @KafkaListener(topics = "widget-events")
  public void onWidgetEvent(String payload) {
    // consume
  }

  // websocket-mapping — a STOMP destination (ends in `Mapping` but NOT HTTP).
  @MessageMapping("/widgets/subscribe")
  public void onSubscribe(String message) {
    // ws handler
  }

  // event-listener — an application-event consumer entry point.
  @EventListener
  public void onApplicationEvent(Object event) {
    // handle event
  }

  // NON-HTTP `@*Mapping` pollution the allow-list MUST exclude from `endpoint`.
  @Mapping(target = "x", source = "y")
  Object mapStructStyle(Object in) {
    return in;
  }
}
